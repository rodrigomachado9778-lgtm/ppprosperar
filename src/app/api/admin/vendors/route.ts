import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/src/lib/firebase/admin";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";
import crypto from "crypto";

export const runtime = "nodejs";


function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function isAdminToken(decoded: any) {
  return decoded && decoded.role === "admin";
}

function randomPassword() {
  // 16 chars: letters + numbers (sem caracteres confusos)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export async function POST(req: Request) {
  const decoded = await verifyFirebaseIdTokenFromRequest(req);
  if (!isAdminToken(decoded)) return jsonError("Acesso negado.", 403);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = body?.name ? String(body.name).trim() : null;
  const activeEditionId = body?.activeEditionId ? String(body.activeEditionId) : null;
  const password = body?.password ? String(body.password) : randomPassword();

  if (!email || !email.includes("@")) return jsonError("E-mail inválido.");
  if (password.length < 8) return jsonError("Senha deve ter no mínimo 8 caracteres.");

  const auth = getAdminAuth();
  const db = getAdminDb();

  // 1) cria usuário no Auth
  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: name ?? undefined,
      emailVerified: true,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Falha ao criar usuário.");
    // erro comum: email já existe
    return jsonError(msg, 400);
  }

  // 2) seta custom claim role=vendor
  await auth.setCustomUserClaims(userRecord.uid, { role: "vendor" });

  // 3) cria perfil em /users/{uid} (somente ADMIN consegue escrever por rules)
  await db.collection("users").doc(userRecord.uid).set(
    {
      uid: userRecord.uid,
      email,
      role: "vendor",
      displayName: name,
      activeEditionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true },
  );

  return NextResponse.json({
    ok: true,
    uid: userRecord.uid,
    email,
    tempPassword: password,
  });
}
