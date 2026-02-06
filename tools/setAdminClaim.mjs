/**
 * Set custom claim role=admin for a user and ensure /users/{uid} exists.
 *
 * Usage:
 *   npm run set-admin-claim -- <UID> [email]
 *
 * Notes:
 * - Loads .env.local automatically.
 * - If email is not provided, we try to read it from Firebase Auth.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

function getPrivateKey() {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!raw) return undefined;
  return raw.replace(/\\n/g, "\n");
}

function ensureAdminApp() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin env vars. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.",
    );
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const uid = process.argv[2];
  const emailArg = (process.argv[3] ?? "").toLowerCase().trim();
  if (!uid) {
    console.error("Usage: npm run set-admin-claim -- <UID> [email]");
    process.exit(1);
  }

  ensureAdminApp();
  const auth = getAuth();
  const db = getFirestore();

  let email = emailArg;
  if (!email) {
    try {
      const u = await auth.getUser(uid);
      email = String(u.email ?? "").toLowerCase();
    } catch {
      // ignore
    }
  }

  await auth.setCustomUserClaims(uid, { role: "admin" });

  if (email) {
    await db.collection("users").doc(uid).set(
      {
        uid,
        email,
        role: "admin",
        activeEditionId: null,
        updatedAt: new Date(),
      },
      { merge: true },
    );
  }

  console.log("OK: role=admin set for uid:", uid);
  if (email) console.log("OK: /users profile ensured for:", email);
  console.log("Now log out and log back in so the ID token refreshes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
