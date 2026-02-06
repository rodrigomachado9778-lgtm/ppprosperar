"use client";

export function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cpfToHash(cpfDigits: string): Promise<string> {
  const salt = process.env.NEXT_PUBLIC_CPF_HASH_SALT ?? "prosperar";
  return sha256Hex(`${salt}:${cpfDigits}`);
}

export function normalizePrintedToInt(value: string): string {
  // Mantém apenas dígitos e remove zeros à esquerda; "0000" vira "0"
  const d = onlyDigits(value);
  const n = d.replace(/^0+(?=\d)/, "");
  return n || "0";
}
