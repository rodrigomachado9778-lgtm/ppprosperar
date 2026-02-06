import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin (server-only)
 *
 * Required env vars:
 * - FIREBASE_ADMIN_PROJECT_ID
 * - FIREBASE_ADMIN_CLIENT_EMAIL
 * - FIREBASE_ADMIN_PRIVATE_KEY (with literal "\\n" inside .env.local)
 */

function readRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing Firebase Admin env var: ${name}. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.`,
    );
  }
  return v;
}

function getPrivateKey(): string {
  const raw = readRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY");
  // Vercel/Windows usually stores multiline keys with literal "\n"
  return raw.replace(/\\n/g, "\n");
}

export function ensureAdminApp() {
  if (getApps().length) return;

  const projectId = readRequiredEnv("FIREBASE_ADMIN_PROJECT_ID");
  const clientEmail = readRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL");
  const privateKey = getPrivateKey();

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}

export function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}
