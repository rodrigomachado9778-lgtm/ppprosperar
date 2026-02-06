export function formatBRLFromCents(cents: number): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseBRLCents(input: string): number {
  // Aceita "10", "10,50", "10.50", "R$ 10,50"
  const clean = input.replace(/[^0-9,\.]/g, "").trim();
  if (!clean) return 0;

  // Se tiver vírgula, assume separador decimal.
  if (clean.includes(",")) {
    const [intPart, decPart = ""] = clean.split(",");
    const cents = (decPart + "00").slice(0, 2);
    return parseInt(intPart || "0", 10) * 100 + parseInt(cents, 10);
  }

  // Se tiver ponto, assume decimal.
  if (clean.includes(".")) {
    const [intPart, decPart = ""] = clean.split(".");
    const cents = (decPart + "00").slice(0, 2);
    return parseInt(intPart || "0", 10) * 100 + parseInt(cents, 10);
  }

  return parseInt(clean, 10) * 100;
}

export function normalizePublicNumber(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseNumbersList(value: string): number[] {
  // aceita separadores: espaço, vírgula, ponto e vírgula, quebra de linha
  const parts = value
    .split(/[\s,;]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const nums = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n));
  return nums;
}

export function validateCardNumbers(nums: number[]): { ok: boolean; message?: string } {
  if (nums.length !== 20) return { ok: false, message: "A cartela deve ter exatamente 20 números." };
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return { ok: false, message: "Todos os números devem ser inteiros entre 1 e 50." };
    }
  }
  const set = new Set(nums);
  if (set.size !== nums.length) return { ok: false, message: "Não pode haver números repetidos na cartela." };
  return { ok: true };
}

export function validateDrawNumber(n: number): { ok: boolean; message?: string } {
  if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, message: "Número inválido. Use 1 a 50." };
  return { ok: true };
}


export function normalizeCardNumberInput(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function formatPrintedNumber(n: number, minDigits = 4): string {
  const s = String(n);
  if (s.length >= minDigits) return s;
  return s.padStart(minDigits, "0");
}

export function parseCardNumbersBatch(value: string): number[] {
  const parts = value
    .split(/[\s,;\n\r]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const nums: number[] = [];
  for (const p of parts) {
    const n = normalizeCardNumberInput(p);
    if (n != null) nums.push(n);
  }
  // remove duplicados preservando ordem
  const seen = new Set<number>();
  return nums.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
}
