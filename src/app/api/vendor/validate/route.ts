import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";
import { makeBuyerLookupHash } from "@/src/lib/prosperar/lookupHash.server";

export const runtime = "nodejs";


function jsonError(message: string, status = 400, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, message, ...(extra ?? {}) }, { status });
}

function jsonOk(data: Record<string, any>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function requireVendor(decoded: any) {
  return decoded && decoded.uid && (decoded.role === "vendor" || decoded.role === "admin");
}

function readCpfSalt(): string {
  // Keep compatibility with existing client hashing.
  return (
    process.env.CPF_HASH_SALT ||
    process.env.NEXT_PUBLIC_CPF_HASH_SALT ||
    "prosperar"
  );
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function cpfToHashServer(cpfDigits: string): string {
  const salt = readCpfSalt();
  return sha256Hex(`${salt}:${cpfDigits}`);
}

type Body = {
  editionId: string;
  cardPublicNumbers: number[];
  buyerName: string;
  buyerPhoneE164: string; // "+55..."
  buyerCpfDigits: string; // "00000000000"
};

/**
 * Vendor validation + sale registration (server-side transaction).
 * This avoids client-side permission/transaction problems and keeps security consistent.
 */
export async function POST(req: Request) {
  let decoded: any;
  try {
    decoded = await verifyFirebaseIdTokenFromRequest(req);
  } catch (e: any) {
    const status = Number((e as any)?.status ?? 401);
    return jsonError(String(e?.message ?? "Não autorizado."), status);
  }

  if (!requireVendor(decoded)) return jsonError("Acesso negado.", 403);

  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = null;
  }

  const editionId = String(body?.editionId ?? "").trim();
  const numsIn = Array.isArray(body?.cardPublicNumbers) ? body!.cardPublicNumbers : [];
  const buyerName = String(body?.buyerName ?? "").trim();
  const buyerPhoneE164 = String(body?.buyerPhoneE164 ?? "").trim();
  const buyerCpfDigits = String(body?.buyerCpfDigits ?? "").replace(/\D/g, "");

  if (!editionId) return jsonError("editionId obrigatório.", 422);
  if (!buyerName || buyerName.length < 2) return jsonError("Nome do comprador inválido.", 422);
  if (!buyerPhoneE164.startsWith("+") || buyerPhoneE164.length < 8) return jsonError("Telefone inválido.", 422);
  if (buyerCpfDigits.length !== 11) return jsonError("CPF inválido.", 422);

  const cardPublicNumbers = Array.from(
    new Set(
      numsIn
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .map((n) => Math.floor(n)),
    ),
  );

  if (!cardPublicNumbers.length) return jsonError("Nenhuma cartela informada.", 422);

  const db = getAdminDb();
  const vendorUid = String(decoded.uid);
  const vendorEmailSnapshot = String(decoded.email ?? "");

  const cpfHash = cpfToHashServer(buyerCpfDigits);
  const cpfLast4 = buyerCpfDigits.slice(-4);

  try {
    const result = await db.runTransaction(async (tx) => {
      // edition
      const edRef = db.collection("editions").doc(editionId);
      const edSnap = await tx.get(edRef);
      if (!edSnap.exists) throw new Error("edition_not_found");
      const ed = edSnap.data() as any;
      const st = String(ed?.status ?? "READY");
      if (st === "RUNNING" || st === "FINISHED") throw new Error("sales_locked");

      // vendor permissions
      const permRef = db.collection("editions").doc(editionId).collection("vendor_permissions").doc(vendorUid);
      const permSnap = await tx.get(permRef);
      const permArr = permSnap.exists && Array.isArray((permSnap.data() as any)?.batches)
        ? ((permSnap.data() as any).batches as any[])
        : [];
      const allowedBatches = new Set(
        permArr
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
          .map((n: number) => Math.floor(n)),
      );
      if (allowedBatches.size === 0) throw new Error("no_batches");

      // buyer
      const buyersCol = db.collection("buyers");
      const phoneLookupRef = db.collection("buyers_lookup_phone").doc(buyerPhoneE164);
      const cpfLookupRef = db.collection("buyers_lookup_cpf").doc(cpfHash);

      const [phoneLookupSnap, cpfLookupSnap] = await Promise.all([
        tx.get(phoneLookupRef),
        tx.get(cpfLookupRef),
      ]);

      const buyerIdFromPhone = phoneLookupSnap.exists ? String((phoneLookupSnap.data() as any)?.buyerId ?? "") : "";
      const buyerIdFromCpf = cpfLookupSnap.exists ? String((cpfLookupSnap.data() as any)?.buyerId ?? "") : "";

      let buyerId = buyerIdFromCpf || buyerIdFromPhone;
      if (buyerIdFromCpf && buyerIdFromPhone && buyerIdFromCpf !== buyerIdFromPhone) {
        throw new Error("buyer_conflict");
      }

      if (!buyerId) {
        buyerId = buyersCol.doc().id;
      }

      const buyerRef = buyersCol.doc(buyerId);
      const buyerSnap = await tx.get(buyerRef);

      // public resultado lookup (server-only read)
      let buyerHashLookupRef: FirebaseFirestore.DocumentReference | null = null;
      try {
        const hash = makeBuyerLookupHash(buyerPhoneE164, buyerCpfDigits);
        buyerHashLookupRef = db.collection("buyers_lookup_hash").doc(hash);
      } catch {
        buyerHashLookupRef = null;
      }
      const buyerHashLookupSnap = buyerHashLookupRef ? await tx.get(buyerHashLookupRef) : null;

      // validate cards first (strict mode)
      const cardsCol = db.collection("editions").doc(editionId).collection("cards");
      const okNums: number[] = [];
      const cardRefs: FirebaseFirestore.DocumentReference[] = [];
      const badMsgs: string[] = [];

      for (const n of cardPublicNumbers) {
        const q = cardsCol.where("publicNumberInt", "==", n).limit(2);
        const snap = await tx.get(q);
        if (snap.empty) {
          badMsgs.push(`${n} (não encontrada)`);
          continue;
        }
        if (snap.size !== 1) {
          badMsgs.push(`${n} (duplicada)`);
          continue;
        }
        const d = snap.docs[0];
        const c = d.data() as any;

        const batchNum = Number(c?.batch);
        if (!Number.isFinite(batchNum) || batchNum <= 0) {
          badMsgs.push(`${n} (lote inválido)`);
          continue;
        }
        if (!allowedBatches.has(Math.floor(batchNum))) {
          badMsgs.push(`${n} (lote ${batchNum} não liberado)`);
          continue;
        }
        if (String(c?.status) !== "AVAILABLE") {
          badMsgs.push(`${n} (estado: ${String(c?.status ?? "-")})`);
          continue;
        }

        okNums.push(n);
        cardRefs.push(d.ref);
      }

      if (badMsgs.length) {
        const err: any = new Error("strict_failed");
        err.bad = badMsgs;
        throw err;
      }
      if (!okNums.length) throw new Error("no_valid_cards");

      // sale doc (one per buyer+vendor+edition)
      const salesCol = db.collection("editions").doc(editionId).collection("sales");
      const saleId = `${buyerId}_${vendorUid}`;
      const saleRef = salesCol.doc(saleId);
      const saleSnap = await tx.get(saleRef);

      // write buyer + lookups
      if (!buyerSnap.exists) {
        tx.set(buyerRef, {
          name: buyerName,
          phoneE164: buyerPhoneE164,
          cpfHash,
          cpfLast4,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedByUid: vendorUid,
        });
      } else {
        const prev = buyerSnap.data() as any;
        const updates: any = { updatedAt: new Date(), updatedByUid: vendorUid };
        if (buyerName && buyerName !== String(prev?.name ?? "")) updates.name = buyerName;
        if (buyerPhoneE164 && buyerPhoneE164 !== String(prev?.phoneE164 ?? "")) updates.phoneE164 = buyerPhoneE164;
        if (!prev?.cpfHash) {
          updates.cpfHash = cpfHash;
          updates.cpfLast4 = cpfLast4;
        }
        tx.set(buyerRef, updates, { merge: true });
      }

      if (!phoneLookupSnap.exists) tx.set(phoneLookupRef, { buyerId });
      if (!cpfLookupSnap.exists) tx.set(cpfLookupRef, { buyerId });

      if (buyerHashLookupRef && buyerHashLookupSnap) {
        if (!buyerHashLookupSnap.exists) {
          tx.set(buyerHashLookupRef, { buyerId, createdAt: new Date(), updatedAt: new Date() });
        } else {
          const existingBuyerId = String((buyerHashLookupSnap.data() as any)?.buyerId ?? "");
          if (existingBuyerId && existingBuyerId !== buyerId) throw new Error("hash_already_used");
        }
      }

      // update cards
      for (const ref of cardRefs) {
        tx.update(ref, {
          status: "VALIDATED",
          validatedAt: new Date(),
          validatedByUid: vendorUid,
          saleId: saleRef.id,
        });
      }

      const printed = okNums.map(String);

      if (saleSnap.exists) {
        const s = saleSnap.data() as any;
        const prevPublic = Array.isArray(s.cardPublicNumbers) ? s.cardPublicNumbers.map(String) : [];
        const nextPublic = [...prevPublic];
        for (const v of okNums.map(String)) if (!nextPublic.includes(v)) nextPublic.push(v);

        tx.update(saleRef, {
          buyerId,
          buyerNameSnapshot: buyerName,
          buyerPhoneSnapshot: buyerPhoneE164,
          buyerCpfLast4Snapshot: cpfLast4,
          vendorUid,
          vendorEmailSnapshot: String(s.vendorEmailSnapshot ?? "") || vendorEmailSnapshot,
          cardPublicNumbers: nextPublic,
          // printedNumbers: union previous printed with newly validated cards
          cardPrintedNumbers: (() => {
            const prevPrinted = Array.isArray(s.cardPrintedNumbers) ? s.cardPrintedNumbers.map(String) : [];
            const nextPrinted = [...prevPrinted];
            for (const v of okNums.map(String)) if (!nextPrinted.includes(v)) nextPrinted.push(v);
            // if there were no printed numbers yet, default to public numbers
            if (nextPrinted.length === 0) return nextPublic;
            return nextPrinted;
          })(),
          updatedAt: new Date(),
          lastPurchaseAt: new Date(),
        });
      } else {
        tx.set(saleRef, {
          buyerId,
          buyerNameSnapshot: buyerName,
          buyerPhoneSnapshot: buyerPhoneE164,
          buyerCpfLast4Snapshot: cpfLast4,
          vendorUid,
          vendorEmailSnapshot,
          cardPublicNumbers: okNums.map(String),
          cardPrintedNumbers: printed,
          createdAt: new Date(),
          lastPurchaseAt: new Date(),
        });
      }

      return { saleId: saleRef.id, okNums };
    });

    return jsonOk(result, 200);
  } catch (e: any) {
    const m = String(e?.message ?? "");
    if (m === "sales_locked") return jsonError("Cadastro bloqueado: o sorteio já foi iniciado nesta edição.", 409);
    if (m === "no_batches") return jsonError("Você ainda não tem nenhum lote liberado para venda nesta edição.", 403);
    if (m === "edition_not_found") return jsonError("Edição não encontrada.", 404);
    if (m === "buyer_conflict") return jsonError("Conflito entre CPF e telefone.", 409);
    if (m === "hash_already_used") return jsonError("Não foi possível vincular CPF+telefone a este comprador.", 409);
    if (m === "strict_failed") {
      return jsonError("Uma ou mais cartelas falharam. Nenhuma venda foi registrada.", 422, { bad: e?.bad ?? [] });
    }
    return jsonError("Não foi possível cadastrar agora.", 500);
  }
}
