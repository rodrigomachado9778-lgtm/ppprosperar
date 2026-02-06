import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";

export const runtime = "nodejs";


function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function requireAdmin(decoded: any) {
  return decoded && decoded.role === "admin";
}

export async function DELETE(req: Request, ctx: { params: { uid: string } }) {
  const decoded = await verifyFirebaseIdTokenFromRequest(req);
  if (!requireAdmin(decoded)) return jsonError("Acesso negado.", 403);

  // Next.js can provide params as a Promise in some runtimes (e.g. Turbopack).
  // Awaiting works for both promise and non-promise values.
  const { uid } = await (ctx as any).params;
  if (!uid) return jsonError("UID inválido.", 422);

  const auth = getAdminAuth();
  const db = getAdminDb();

  // Best-effort: remove auth user
  try {
    await auth.deleteUser(uid);
  } catch (e: any) {
    // If user not found, continue to clean Firestore profile anyway
    const code = String(e?.code ?? "");
    if (!code.includes("auth/user-not-found")) {
      return jsonError(String(e?.message ?? "Falha ao excluir usuário."), 400);
    }
  }

  // Remove profile
  try {
    await db.collection("users").doc(uid).delete();
  } catch {
    // ignore
  }

  return jsonOk({ uid });
}

export async function PATCH(req: Request, ctx: { params: { uid: string } }) {
  const decoded = await verifyFirebaseIdTokenFromRequest(req);
  if (!requireAdmin(decoded)) return jsonError("Acesso negado.", 403);

  // Next.js can provide params as a Promise in some runtimes (e.g. Turbopack).
  const { uid } = await (ctx as any).params;
  if (!uid) return jsonError("UID inválido.", 422);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const activeEditionId = body?.activeEditionId === null ? null : (body?.activeEditionId ? String(body.activeEditionId) : undefined);
  const displayName = body?.displayName === null ? null : (body?.displayName ? String(body.displayName) : undefined);

  if (activeEditionId === undefined && displayName === undefined) {
    return jsonError("Nada para atualizar.", 422);
  }

  const db = getAdminDb();
  const patch: any = { updatedAt: new Date() };
  if (activeEditionId !== undefined) patch.activeEditionId = activeEditionId;
  if (displayName !== undefined) patch.displayName = displayName;

  await db.collection("users").doc(uid).set(patch, { merge: true });

  return jsonOk({ uid, ...patch });
}
