import { NextResponse } from "next/server";
import { getAdminDb } from "@/src/lib/firebase/admin";
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

function bad(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const editionId = String(body.editionId ?? "");
    if (!editionId) return bad(400, "editionId é obrigatório.");

    const phoneE164 = normalizePhoneBRToE164(String(body.phone ?? ""));
    const cpfDigits = validateCPF(String(body.cpf ?? ""));
    if (!phoneE164) return bad(400, "Telefone inválido.");
    if (!cpfDigits) return bad(400, "CPF inválido.");

    const db = getAdminDb();

    // Ensure edition exists (public page still needs a valid edition)
    const editionRef = db.collection("editions").doc(editionId);
    const editionSnap = await editionRef.get();
    if (!editionSnap.exists) return bad(404, "Edição não encontrada.");
    const edition = editionSnap.data() as any;

    // 1) Resolve buyerId via salted hash lookup
    const hash = makeBuyerLookupHash(phoneE164, cpfDigits);
    const lookupSnap = await db.collection("buyers_lookup_hash").doc(hash).get();
    if (!lookupSnap.exists) {
      // Neutral message (avoid confirming existence)
      return bad(404, "Dados não encontrados.");
    }
    const buyerId = String((lookupSnap.data() as any)?.buyerId ?? "");
    if (!buyerId) return bad(404, "Dados não encontrados.");

    // 2) Fetch sales for this buyer in the chosen edition
    const salesSnap = await editionRef.collection("sales").where("buyerId", "==", buyerId).limit(200).get();

    const saleRows = salesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Prefer the most recent snapshot name (fallback to buyers/{buyerId}.name)
    let buyerName = "";
    saleRows.sort((a, b) => {
      const as = typeof a.lastPurchaseAt?.seconds === "number" ? a.lastPurchaseAt.seconds : 0;
      const bs = typeof b.lastPurchaseAt?.seconds === "number" ? b.lastPurchaseAt.seconds : 0;
      return bs - as;
    });
    buyerName = String(saleRows[0]?.buyerNameSnapshot ?? "");
    if (!buyerName) {
      const buyerSnap = await db.collection("buyers").doc(buyerId).get().catch(() => null);
      buyerName = buyerSnap?.exists ? String((buyerSnap.data() as any)?.name ?? "") : "";
    }

    const publicNumsSet = new Set<number>();
    for (const s of saleRows) {
      const arr = Array.isArray(s.cardPublicNumbers) ? s.cardPublicNumbers : [];
      for (const n of arr) {
        const v = Number(n);
        if (Number.isFinite(v) && v > 0) publicNumsSet.add(v);
      }
    }
    const publicNums = Array.from(publicNumsSet).sort((a, b) => a - b);

    // 3) Fetch card status/printedNumber for these public numbers
    const cards: Array<{ publicNumberInt: number; printedNumber: string; status: string }> = [];
    for (let i = 0; i < publicNums.length; i += 30) {
      const chunk = publicNums.slice(i, i + 30);
      const q = await editionRef.collection("cards").where("publicNumberInt", "in", chunk).get();
      for (const docSnap of q.docs) {
        const d = docSnap.data() as any;
        cards.push({
          publicNumberInt: Number(d.publicNumberInt ?? 0),
          printedNumber: String(d.printedNumber ?? ""),
          status: String(d.status ?? ""),
        });
      }
    }
    cards.sort((a, b) => (a.publicNumberInt ?? 0) - (b.publicNumberInt ?? 0));

    return NextResponse.json(
      {
        edition: {
          id: editionId,
          name: String(edition.name ?? ""),
          status: String(edition.status ?? ""),
          youtubeUrl: edition.youtubeUrl ?? null,
          scheduledAt: edition.scheduledAt ?? null,
        },
        buyer: {
          name: buyerName,
        },
        cards,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar agora." }, { status: 500 });
  }
}
