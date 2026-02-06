import crypto from "crypto";

/**
 * Server-only: builds a stable, non-enumerable lookup hash for public result checks.
 *
 * hash = sha256(LOOKUP_HASH_SALT + ":" + phoneE164 + ":" + cpfDigits)
 */
export function makeBuyerLookupHash(phoneE164: string, cpfDigits: string): string {
  const salt = process.env.LOOKUP_HASH_SALT;
  if (!salt) {
    throw new Error("Missing LOOKUP_HASH_SALT env var");
  }

  const base = `${salt}:${phoneE164}:${cpfDigits}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}
