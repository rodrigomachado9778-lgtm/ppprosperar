export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";

type JsonOk<T extends Record<string, any>> = { ok: true } & T;
type JsonErr = { ok: false; message: string } & Record<string, any>;

function jsonError(message: string, status = 400, extra?: Record<string, any>) {
  const body: JsonErr = { ok: false, message, ...(extra ?? {}) };
  return NextResponse.json(body, { status });
}

function jsonOk<T extends Record<string, any>>(data: T, status = 200) {
  const body: JsonOk<T> = { ok: true, ...data };
  return NextResponse.json(body, { status });
}

type Decoded = {
  uid: string;
  role?: "admin" | "vendor" | string;
};

function requireUser(decoded: any): decoded is Decoded {
  const role = decoded?.role;
  return Boolean(decoded?.uid) && (role === "admin" || role === "vendor");
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function safeCount(q: any): Promise<number> {
  try {
    const snap = await q.count().get();
    const c = (snap.data() as any)?.count;
    if (typeof c === "number") return c;
  } catch {}
  const snap = await q.limit(5000).get();
  return snap.size;
}

export async function GET(req: Request) {
  let decoded: Decoded;

  try {
    decoded = (await verifyFirebaseIdTokenFromRequest(req)) as any;
  } catch (e: any) {
    const status = Number(e?.status ?? 401);
    return jsonError(String(e?.message ?? "Não autorizado."), status);
  }

  if (!requireUser(decoded)) {
    return jsonError("Acesso negado.", 403);
  }

  const db = getAdminDb();
  const uid = String(decoded.uid);
  const role = String(decoded.role);

  const url = new URL(req.url);
  const requestedEditionId = url.searchParams.get("editionId");

  // config/system.currentEditionId
  const sysSnap = await db.collection("config").doc("system").get();
  const sys = sysSnap.exists ? (sysSnap.data() as any) : null;
  const sysEditionId = String(sys?.currentEditionId ?? "");

  let editionId = sysEditionId;

  // admin pode escolher
  if (role === "admin" && requestedEditionId) {
    editionId = String(requestedEditionId);
  }

  // vendor usa users/{uid}.activeEditionId (fallback sys)
  if (role === "vendor") {
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.exists ? (userSnap.data() as any) : null;
    const ae = String(u?.activeEditionId ?? "");
    if (ae) editionId = ae;
  }

  // Admin: lista de edições (modal selector)
  let editionsList: any[] | undefined;
  if (role === "admin") {
    try {
      const edsSnap = await db.collection("editions").orderBy("createdAt", "desc").limit(25).get();
      editionsList = edsSnap.docs.map((d) => {
        const e = d.data() as any;
        const price = Number(e?.cardPriceCents ?? sys?.cardPriceCents ?? 0) || 0;
        return {
          id: d.id,
          name: String(e?.name ?? d.id),
          status: String(e?.status ?? ""),
          createdAt: e?.createdAt ?? null,
          scheduledAt: e?.scheduledAt ?? null,
          roundsCount: Number(e?.roundsCount ?? 0) || null,
          cardPriceCents: price || null,
        };
      });
    } catch {
      editionsList = [];
    }
  }

  // Sem edição selecionada
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

  const myCardsSold = await safeCount(
    cardsCol.where("validatedByUid", "==", uid).where("status", "==", "VALIDATED"),
  );
  const mySalesCount = await safeCount(salesCol.where("vendorUid", "==", uid));

  const cardPriceCents = Number(ed?.cardPriceCents ?? sys?.cardPriceCents ?? 0) || 0;
  const revenueCents = Math.max(0, cardsValidated) * Math.max(0, cardPriceCents);

  // Trend last 14 days
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 13);
  start.setHours(0, 0, 0, 0);

  const bucket: Record<string, { date: string; sales: number; cards: number }> = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toISODate(d);
    bucket[key] = { date: key, sales: 0, cards: 0 };
  }

  // Sales in window
  try {
    const salesSnap = await salesCol
      .where("lastPurchaseAt", ">=", start)
      .orderBy("lastPurchaseAt", "desc")
      .limit(1000)
      .get();

    for (const doc of salesSnap.docs) {
      const data = doc.data() as any;
      const ts = data?.lastPurchaseAt?.toDate ? data.lastPurchaseAt.toDate() : data?.lastPurchaseAt;
      if (!(ts instanceof Date)) continue;
      const key = toISODate(ts);
      if (bucket[key]) bucket[key].sales += 1;
    }
  } catch {
    // sem índice? mantém 0
  }

  // Validated cards in window
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
      if (!(ts instanceof Date)) continue;
      const key = toISODate(ts);
      if (bucket[key]) bucket[key].cards += 1;
    }
  } catch {
    // sem índice? mantém 0
  }

  const trend = Object.values(bucket);

  // Top vendors (admin only)
  const topVendors: { vendorUid: string; vendorEmail: string; salesCount: number; cardsSold: number }[] = [];
  if (role === "admin") {
    try {
      const salesSnap = await salesCol.orderBy("lastPurchaseAt", "desc").limit(1500).get();
      const agg: Record<string, { vendorUid: string; vendorEmail: string; salesCount: number; cardsSold: number }> =
        {};

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
    try {
      const roundsSnap = await edRef.collection("rounds").orderBy("index", "asc").get();
      const rounds = roundsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      const totalPrizeCents = rounds.reduce((acc, r) => acc + (Number(r?.prizeCents) || 0), 0);
      const roundsStatusCount = rounds.reduce((acc: any, r: any) => {
        const st = String(r?.status ?? "READY");
        acc[st] = (acc[st] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const runningRound = rounds.find((r) => String(r?.status ?? "") === "RUNNING") || null;

      editionDetails = {
        totalPrizeCents,
        roundsStatusCount,
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
      cardsSold: cardsValidated,
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
