// src/lib/firebase/client.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// ⚠️ Validação SÓ no browser
function assertEnv() {
  if (typeof window === "undefined") return;

  for (const [k, v] of Object.entries(firebaseConfig)) {
    if (!v) {
      throw new Error(`[firebase] env ausente: ${k} (use .env.local)`);
    }
  }
}

assertEnv();

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


// Keep the user signed in across browser restarts.
// (This does NOT make ID tokens never expire; it enables automatic refresh + persistence.)
if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // ignore (some environments block persistence)
  });
}
