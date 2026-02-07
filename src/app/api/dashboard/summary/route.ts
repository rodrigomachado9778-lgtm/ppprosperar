import { NextResponse } from "next/server";
import { getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, message, ...(extra ?? {}) }, { status });
}
function jsonOk(data: Record<string, any>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function requireUser(decoded: any) {
  return decoded && decoded.uid && (decoded.role === "admin" || decoded.role === "vendor");
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function toTsMillis(v: any): number | null {
  try {
    if (!v) return null;
    const d = v?.toDate ? v.toDate() : v;
    if (d instanceof Date) return d.getTime();
    if (typeof d === "number") return d;
  } catch {}
  return null;
}

async function safeCount(q: any): Promise<number> {
  // firebase-admin Firestore supports aggregation count() in modern SDKs.
  try {
    const snap = await q.count().get();
    // snap.data().count is the standard shape
    const c = (snap.data() as any)?.count;
    if (typeof c === "number") return c;
  } catch {}
  // Fallback: fetch a limited batch and count (not perfect for large sets).
  const snap = await q.limit(5000).get();
  return snap.size;
}

export async function GET(req: Request) {
  let decoded: any;
  try {
    decoded = await verifyFirebaseIdTokenFromRequest(req);
  } catch (e: any) {
    const status = Number((e as any)?.status ?? 401);
    return jsonError(String(e?.message ?? "Não autorizado."), status);
  }

  if (!requireUser(decoded)) return jsonError("Acesso negado.", 403);

  const db = getAdminDb();
  const uid = String(decoded.uid);
  const role = String(decoded.role);

  const url = new URL(req.url);
  const requestedEditionId = url.searchParams.get("editionId");

  // Resolve edition id:
  // - current: config/system.currentEditionId
  // - admin can request a specific edition via ?editionId=
  // - vendor: users/{uid}.activeEditionId (fallback to config/system.currentEditionId)
  const sysSnap = await db.collection("config").doc("system").get();
  const sys = sysSnap.exists ? (sysSnap.data() as any) : null;
  const sysEditionId = String(sys?.currentEditionId ?? "");

  let editionId = sysEditionId;
  if (role === "admin" && requestedEditionId) {
    editionId = String(requestedEditionId);
  }
  if (role === "vendor") {
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.exists ? (userSnap.data() as any) : null;
    const ae = String(u?.activeEditionId ?? "");
    if (ae) editionId = ae;
  }

  // Admin: list editions for the selector modal (lightweight list).
  let editionsList: any[] | undefined = undefined;
  if (role === "admin") {
    try {
      const edsSnap = await db.collection("editions").orderBy("createdAt", "desc").limit(25).get();
      editionsList = edsSnap.docs.map((d) => {
        const e = d.data() as any;
        const ePriceCents = Number(e?.cardPriceCents ?? sys?.cardPriceCents ?? 0) || 0;
        return {
          id: d.id,
          name: String(e?.name ?? d.id),
          status: String(e?.status ?? ""),
          createdAt: e?.createdAt ?? null,
          scheduledAt: e?.scheduledAt ?? null,
          roundsCount: Number(e?.roundsCount ?? 0) || null,
          cardPriceCents: ePriceCents || null,
        };
      });
    } catch {
      editionsList = [];
    }
  }

  if (!editionId) {
    return jsonOk({
      role,
      currentEditionId: sysEditionId || null,
      editionsList,
      edition: null,
      kpis: {
        cardsTotal: 0,
        cardsValidated: 0,
        cardsAvailable: 0,
        salesCount: 0,
        revenueCents: 0,
        cardPriceCents: 0,
        cardsSold: 0,
        myCardsSold: 0,
        mySalesCount: 0,
      },
      trend: [],
      topVendors: [],
      editionDetails: null,
      // past editions are loaded via editionsList for the admin modal
    });
  }

  const edRef = db.collection("editions").doc(editionId);
  const edSnap = await edRef.get();
  if (!edSnap.exists) return jsonError("Edição não encontrada.", 404);
  const ed = edSnap.data() as any;

  const cardsCol = edRef.collection("cards");
  const salesCol = edRef.collection("sales");

  // Counts
  const cardsTotal = await safeCount(cardsCol);
  const cardsValidated = await safeCount(cardsCol.where("status", "==", "VALIDATED"));
  const cardsAvailable = await safeCount(cardsCol.where("status", "==", "AVAILABLE"));
  const salesCount = await safeCount(salesCol);

  const myCardsSold = await safeCount(cardsCol.where("validatedByUid", "==", uid).where("status", "==", "VALIDATED"));
  const mySalesCount = await safeCount(salesCol.where("vendorUid", "==", uid));

  // Revenue estimation: prefer edition.cardPriceCents, fallback to config/system.cardPriceCents.
  const cardPriceCents = Number(ed?.cardPriceCents ?? sys?.cardPriceCents ?? 0) || 0;
  const revenueCents = Math.max(0, cardsValidated) * Math.max(0, cardPriceCents);

  // Trend: last 14 days (sales + validated cards)
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 13); // inclusive window of 14 days
  start.setHours(0, 0, 0, 0);

  const bucket: Record<string, { date: string; sales: number; cards: number }> = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toISODate(d);
    bucket[key] = { date: key, sales: 0, cards: 0 };
  }

  // Sales docs in window
  try {
    const salesSnap = await salesCol
      .where("lastPurchaseAt", ">=", start)
      .orderBy("lastPurchaseAt", "desc")
      .limit(1000)
      .get();

    for (const doc of salesSnap.docs) {
      const data = doc.data() as any;
      const ts = data?.lastPurchaseAt?.toDate ? data.lastPurchaseAt.toDate() : data?.lastPurchaseAt;
      const d = ts instanceof Date ? ts : null;
      if (!d) continue;
      const key = toISODate(d);
      if (bucket[key]) bucket[key].sales += 1;
    }
  } catch {
    // If there is no index yet, we keep trend sales as 0.
  }

  // Validated cards in window (by validatedAt)
  try {
    const cardsSnap = await cardsCol
      .where("status", "==", "VALIDATED")
      .where("validatedAt", ">=", start)
      .orderBy("validatedAt", "desc")
      .limit(2000)
      .get();

    for (const doc of cardsSnap.docs) {
      const data = doc.data() as any;
      const ts = data?.validatedAt?.toDate ? data.validatedAt.toDate() : data?.validatedAt;
      const d = ts instanceof Date ? ts : null;
      if (!d) continue;
      const key = toISODate(d);
      if (bucket[key]) bucket[key].cards += 1;
    }
  } catch {
    // Keep cards trend as 0 if index missing.
  }

  const trend = Object.values(bucket);

  // Top vendors (admin only)
  const topVendors: { vendorUid: string; vendorEmail: string; salesCount: number; cardsSold: number }[] = [];
  if (role === "admin") {
    try {
      const salesSnap = await salesCol.orderBy("lastPurchaseAt", "desc").limit(1500).get();
      const agg: Record<string, { vendorUid: string; vendorEmail: string; salesCount: number; cardsSold: number }> = {};
      for (const doc of salesSnap.docs) {
        const s = doc.data() as any;
        const vuid = String(s?.vendorUid ?? "");
        const vemail = String(s?.vendorEmailSnapshot ?? "");
        if (!vuid) continue;
        if (!agg[vuid]) agg[vuid] = { vendorUid: vuid, vendorEmail: vemail, salesCount: 0, cardsSold: 0 };
        agg[vuid].salesCount += 1;
        const nums = Array.isArray(s?.cardPublicNumbers) ? s.cardPublicNumbers : [];
        agg[vuid].cardsSold += nums.length;
        if (!agg[vuid].vendorEmail && vemail) agg[vuid].vendorEmail = vemail;
      }
      const all = Object.values(agg);
      all.sort((a, b) => (b.cardsSold - a.cardsSold) || (b.salesCount - a.salesCount));
      topVendors.push(...all.slice(0, 5));
    } catch {
      // ignore
    }
  }

  const edition = {
    id: editionId,
    name: String(ed?.name ?? editionId),
    status: String(ed?.status ?? ""),
    scheduledAt: ed?.scheduledAt ?? null,
    youtubeUrl: ed?.youtubeUrl ?? null,
    roundsCount: Number(ed?.roundsCount ?? 0) || null,
    cardPriceCents: cardPriceCents || null,
    createdAt: ed?.createdAt ?? null,
  };

  // Admin: edition details
  let editionDetails: any = null;
  if (role === "admin") {
    // Rounds summary
    try {
      const roundsSnap = await edRef.collection("rounds").orderBy("index", "asc").get();
      const rounds = roundsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const totalPrizeCents = rounds.reduce((acc, r) => acc + (Number(r?.prizeCents) || 0), 0);
      const byStatus = rounds.reduce(
        (acc: any, r: any) => {
          const st = String(r?.status ?? "READY");
          acc[st] = (acc[st] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const runningRound = rounds.find((r) => String(r?.status ?? "") === "RUNNING") || null;
      editionDetails = {
        totalPrizeCents,
        roundsStatusCount: byStatus,
        runningRound: runningRound
          ? {
              index: Number(runningRound?.index ?? 0) || null,
              drawnNumbersCount: Array.isArray(runningRound?.drawnNumbers) ? runningRound.drawnNumbers.length : 0,
              startedAt: runningRound?.startedAt ?? null,
            }
          : null,
      };
    } catch {
      editionDetails = null;
    }

  }

  return jsonOk({
    role,
    currentEditionId: sysEditionId || null,
    editionsList,
    edition,
    kpis: {
      cardsTotal,
      cardsValidated,
      salesCount,
      cardsSold: cardsValidated, // one validated card == sold
      cardsAvailable,
      revenueCents,
      cardPriceCents,
      myCardsSold,
      mySalesCount,
    },
    trend,
    topVendors,
    editionDetails,
  });
}
