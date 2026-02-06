/**
 * Bootstrap: define um usuário como ADMIN e cria o perfil em /users/{uid}.
 *
 * Uso (local):
 *   node scripts/bootstrap-admin.mjs <UID> <EMAIL>
 *
 * Requisitos: env vars do Firebase Admin SDK (veja .env.example)
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

function getPrivateKey() {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!raw) throw new Error("FIREBASE_ADMIN_PRIVATE_KEY ausente.");
  return raw.replace(/\\n/g, "\n");
}

function ensure() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  if (!projectId || !clientEmail || !privateKey) throw new Error("Env vars do Firebase Admin ausentes.");
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const uid = process.argv[2];
  const email = (process.argv[3] ?? "").toLowerCase();
  if (!uid || !email) {
    console.error("Uso: node scripts/bootstrap-admin.mjs <UID> <EMAIL>");
    process.exit(1);
  }

  ensure();
  const auth = getAuth();
  const db = getFirestore();

  await auth.setCustomUserClaims(uid, { role: "admin" });

  await db.collection("users").doc(uid).set(
    {
      uid,
      email,
      role: "admin",
      activeEditionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true },
  );

  console.log("OK: custom claim role=admin setado e perfil criado em /users/" + uid);
  console.log("IMPORTANTE: o admin deve sair e entrar novamente para atualizar o token.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
