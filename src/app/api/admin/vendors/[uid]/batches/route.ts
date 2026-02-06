import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";

export const runtime = "nodejs";

type JsonOk<T extends Record<string, unknown>> = { ok: true } & T;
type JsonErr = { ok: false; message: string };

function jsonError(message: string, status = 400) {
  return NextResponse.json<JsonErr>({ ok: false, message }, { status });
}

function jsonOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json<JsonOk<T>>({ ok: true, ...data }, { status });
}

function isAdmin(decoded: any) {
  return Boolean(decoded && decoded.role === "admin");
}

function toPositiveIntArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const clean = input
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.floor(n));

  return Array.from(new Set(clean)).sort((a, b) => a - b);
}

/**
 * Marca todos os cards de uma edição/batch como AVAILABLE.
 * Faz paginação para suportar > 500 documentos.
 */
async function markBatchAvailable(editionId: string, batchNumber: number) {
  const db = getAdminDb();
  const cardsCol = db.collection("editions").doc(editionId).collection("cards");

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let updatedTotal = 0;

  while (true) {
    let q: FirebaseFirestore.Query = cardsCol
      .where("batch", "==", batchNumber)
      .where("status", "==", "GENERATED")
      .orderBy("__name__")
      .limit(400);

    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    const b = db.batch();
    const now = new Date();

    for (const d of snap.docs) {
      b.update(d.ref, { status: "AVAILABLE", availableAt: now });
    }

    await b.commit();

    updatedTotal += snap.size;
    last = snap.docs[snap.docs.length - 1];

    if (snap.size < 400) break;
  }

  return updatedTotal;
}

/**
 * PUT /api/admin/vendors/:uid/batches
 * Body:
 *  - editionId: string
 *  - batches: number[]
 *
 * Salva vendor_permissions e marca batches recém adicionados como AVAILABLE.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  // Auth + role
  const decoded = await verifyFirebaseIdTokenFromRequest(req);
  if (!isAdmin(decoded)) return jsonError("Acesso negado.", 403);

  const { uid } = await params;
  if (!uid) return jsonError("UID inválido.", 422);

  // Body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const editionId = body?.editionId ? String(body.editionId) : "";
  const batches = toPositiveIntArray(body?.batches);

  if (!editionId) return jsonError("editionId obrigatório.", 422);

  const db = getAdminDb();
  const permRef = db
    .collection("editions")
    .doc(editionId)
    .collection("vendor_permissions")
    .doc(uid);

  // Carrega estado anterior
  const prevSnap = await permRef.get();
  const prevBatchesRaw =
    prevSnap.exists && Array.isArray((prevSnap.data() as any)?.batches)
      ? ((prevSnap.data() as any).batches as unknown[])
      : [];

  const prevBatches = toPositiveIntArray(prevBatchesRaw);

  // Descobre batches novos (para liberar cards)
  const added = batches.filter((n) => !prevBatches.includes(n));

  // Persiste permissões
  await permRef.set({ batches, updatedAt: new Date() }, { merge: true });

  // Libera cards dos batches adicionados
  let updatedCards = 0;
  for (const bn of added) {
    updatedCards += await markBatchAvailable(editionId, bn);
  }

  return jsonOk({ uid, editionId, batches, addedBatches: added, updatedCards });
}
