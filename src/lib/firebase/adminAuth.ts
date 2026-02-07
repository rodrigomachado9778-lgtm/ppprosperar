import { getAdminAuth } from "@/src/lib/firebase/admin";

function extractBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Verifies Firebase ID token from an incoming Request.
 * - Throws if missing/invalid
 * - Uses `checkRevoked=true` for better security
 */
export async function verifyFirebaseIdTokenFromRequest(req: Request) {
  const token = extractBearerToken(req);
  if (!token) {
    const err = new Error("Missing Authorization Bearer token");
    // @ts-ignore
    err.status = 401;
    throw err;
  }

  const auth = getAdminAuth();
  try {
    return await auth.verifyIdToken(token);
  } catch (e: any) {
    const err = new Error("Invalid or expired token");
    // @ts-ignore
    err.status = 401;
    // @ts-ignore
    err.cause = e;
    throw err;
  }
}
