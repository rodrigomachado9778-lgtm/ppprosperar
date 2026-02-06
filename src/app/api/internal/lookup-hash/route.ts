import { NextResponse } from "next/server";
import { verifyFirebaseIdTokenFromRequest } from "@/src/lib/firebase/adminAuth";
import { makeBuyerLookupHash } from "@/src/lib/prosperar/lookupHash.server";

export const runtime = "nodejs";

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

function normalizePhoneBRToE164(raw: string): string | null {
  const d = onlyDigits(raw);
  if (!d) return null;
  let digits = d;
  if (!digits.startsWith("55")) digits = "55" + digits;
  if (!(digits.length === 12 || digits.length === 13)) return null;
  return "+" + digits;
}

function validateCPF(value: string): string | null {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(cpf)) return null;

  const calc = (base: string, factor: number) => {
    let total = 0;
    for (const ch of base) total += Number(ch) * factor--;
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 9) + String(d1), 11);
  if (String(d1) !== cpf[9] || String(d2) !== cpf[10]) return null;

  return cpf;
}

export async function POST(req: Request) {
  try {
    // Requires Firebase Auth token (used by seller/admin UI only)
    const decoded = await verifyFirebaseIdTokenFromRequest(req);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const phoneE164 = normalizePhoneBRToE164(String(body.phone ?? ""));
    const cpfDigits = validateCPF(String(body.cpf ?? ""));
    if (!phoneE164) return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
    if (!cpfDigits) return NextResponse.json({ error: "CPF inválido." }, { status: 400 });

    const hash = makeBuyerLookupHash(phoneE164, cpfDigits);
    return NextResponse.json({ hash, phoneE164, cpfDigits }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o hash agora." }, { status: 500 });
  }
}
