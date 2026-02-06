#!/usr/bin/env node
/**
 * Backfill vendorUid in editions/*/sales/* documents.
 *
 * Why: vendor screens and Firestore Rules usually require sales.vendorUid == request.auth.uid.
 * Older sales without vendorUid become unreadable for vendors.
 *
 * This script scans sales and sets vendorUid when it can be inferred safely.
 *
 * Inference strategy (in order):
 *  1) Existing fields on the sale: vendorUid / vendorId / sellerUid / validatedByUid
 *  2) Sale document id pattern: <buyerId>_<vendorUid> (common in this project)
 *  3) Look for one card in the edition referencing this saleId and read card.validatedByUid
 *
 * If it can't infer, it skips and prints a warning (no destructive changes).
 *
 * Usage:
 *   node scripts/backfill-sales-vendorUid.mjs --commit
 *   node scripts/backfill-sales-vendorUid.mjs --edition=<EDITION_ID> --commit
 *   node scripts/backfill-sales-vendorUid.mjs --dry-run
 *   node scripts/backfill-sales-vendorUid.mjs --limit=2000 --commit
 *
 * Auth:
 *  - Prefer GOOGLE_APPLICATION_CREDENTIALS (service account JSON path)
 *  - Or FIREBASE_SERVICE_ACCOUNT_JSON (JSON string)
 */

import admin from "firebase-admin";

function parseArgs(argv) {
  const out = {
    commit: false,
    dryRun: true,
    edition: null,
    limit: Infinity,
    pageSize: 500,
  };
  for (const a of argv.slice(2)) {
    if (a === "--commit") {
      out.commit = true;
      out.dryRun = false;
      continue;
    }
    if (a === "--dry-run") {
      out.commit = false;
      out.dryRun = true;
      continue;
    }
    if (a.startsWith("--edition=")) {
      out.edition = a.split("=")[1] || null;
      continue;
    }
    if (a.startsWith("--limit=")) {
      const n = Number(a.split("=")[1]);
      if (Number.isFinite(n) && n >= 0) out.limit = n;
      continue;
    }
    if (a.startsWith("--pageSize=")) {
      const n = Number(a.split("=")[1]);
      if (Number.isFinite(n) && n > 0 && n <= 500) out.pageSize = n;
      continue;
    }
  }
  return out;
}

function initAdmin() {
  if (admin.apps.length) return;

  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (svcJson) {
    const cred = admin.credential.cert(JSON.parse(svcJson));
    admin.initializeApp({ credential: cred });
    return;
  }

  // Fallback: GOOGLE_APPLICATION_CREDENTIALS / Application Default Credentials
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

function pickVendorUidFromSaleData(data) {
  const candidates = [
    data?.vendorUid,
    data?.vendorId,
    data?.sellerUid,
    data?.validatedByUid,
  ].filter(Boolean);

  if (candidates.length === 0) return null;
  const s = String(candidates[0]).trim();
  return s.length ? s : null;
}

function inferVendorUidFromSaleId(saleId) {
  // Common pattern in this project: <buyerId>_<vendorUid>
  const idx = saleId.lastIndexOf("_");
  if (idx <= 0) return null;
  const maybeUid = saleId.slice(idx + 1).trim();
  // Firebase Auth UIDs are often 28 chars, but can vary; basic sanity check
  if (maybeUid.length < 10) return null;
  return maybeUid;
}

async function inferVendorUidFromAnyCard(db, editionId, saleId) {
  // Find any card in this edition that references this sale.
  // Keep it cheap: limit 1.
  const cardsRef = db.collection("editions").doc(editionId).collection("cards");
  const snap = await cardsRef.where("saleId", "==", saleId).limit(1).get();
  if (snap.empty) return null;
  const card = snap.docs[0].data();
  const v = card?.validatedByUid || card?.vendorUid || null;
  return v ? String(v).trim() : null;
}

async function* listEditionDocs(db, onlyEditionId) {
  if (onlyEditionId) {
    const ref = db.collection("editions").doc(onlyEditionId);
    const doc = await ref.get();
    if (!doc.exists) {
      throw new Error(`Edition not found: ${onlyEditionId}`);
    }
    yield doc;
    return;
  }

  const snap = await db.collection("editions").get();
  for (const d of snap.docs) yield d;
}

async function backfill() {
  const args = parseArgs(process.argv);
  initAdmin();
  const db = admin.firestore();

  console.log("\nBackfill sales.vendorUid");
  console.log("Mode:", args.dryRun ? "DRY-RUN" : "COMMIT");
  console.log("Edition:", args.edition ?? "(all)");
  console.log("Limit:", args.limit === Infinity ? "(no limit)" : args.limit);
  console.log("Page size:", args.pageSize);

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalCouldNotInfer = 0;

  for await (const editionDoc of listEditionDocs(db, args.edition)) {
    const editionId = editionDoc.id;
    console.log(`\n== Edition ${editionId} ==`);

    const salesCol = db.collection("editions").doc(editionId).collection("sales");

    // Paginate by doc id (name)
    let lastDoc = null;
    let keepGoing = true;

    while (keepGoing) {
      let q = salesCol.orderBy(admin.firestore.FieldPath.documentId()).limit(args.pageSize);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;

      const batch = db.batch();
      let batchOps = 0;

      for (const doc of snap.docs) {
        if (totalScanned >= args.limit) {
          keepGoing = false;
          break;
        }

        totalScanned += 1;
        const data = doc.data();

        // Skip if already has vendorUid
        const existing = data?.vendorUid ? String(data.vendorUid).trim() : "";
        if (existing) {
          totalSkipped += 1;
          lastDoc = doc;
          continue;
        }

        // Infer
        let vendorUid = pickVendorUidFromSaleData(data);
        if (!vendorUid) vendorUid = inferVendorUidFromSaleId(doc.id);
        if (!vendorUid) vendorUid = await inferVendorUidFromAnyCard(db, editionId, doc.id);

        if (!vendorUid) {
          totalCouldNotInfer += 1;
          console.warn(`  - Could not infer vendorUid for sale ${doc.id} (skipped)`);
          lastDoc = doc;
          continue;
        }

        // Queue update
        if (args.dryRun) {
          console.log(`  * Would set vendorUid for sale ${doc.id} -> ${vendorUid}`);
        } else {
          batch.update(doc.ref, {
            vendorUid,
            vendorUidBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          batchOps += 1;
        }

        totalUpdated += 1;
        lastDoc = doc;
      }

      if (!args.dryRun && batchOps > 0) {
        await batch.commit();
        console.log(`  Committed ${batchOps} updates.`);
      }

      // If we hit the limit, stop this edition loop
      if (!keepGoing) break;

      // If fewer than pageSize docs, no more pages
      if (snap.size < args.pageSize) break;
    }
  }

  console.log("\nDone.");
  console.log("Scanned:", totalScanned);
  console.log("Updated:", totalUpdated);
  console.log("Skipped (already had vendorUid):", totalSkipped);
  console.log("Skipped (could not infer):", totalCouldNotInfer);
  console.log(args.dryRun ? "\nDRY-RUN only: no writes were made." : "\nWrites committed.");
}

backfill().catch((err) => {
  console.error("\nBackfill failed:", err);
  process.exit(1);
});
