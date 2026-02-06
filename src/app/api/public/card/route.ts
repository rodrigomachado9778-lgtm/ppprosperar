import { NextResponse } from "next/server";
import { getAdminDb } from "@/src/lib/firebase/admin";

export const runtime = "nodejs"; // needed for firebase-admin on most platforms

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const editionId = url.searchParams.get("editionId") ?? "";
    const publicNumberIntStr = url.searchParams.get("publicNumberInt") ?? "";

    if (!editionId) return badRequest("editionId é obrigatório.");
    const pn = Number(publicNumberIntStr);
    if (!Number.isFinite(pn) || pn <= 0) return badRequest("publicNumberInt inválido.");

    const db = getAdminDb();

    // Ensure edition exists (and optionally enforce status)
    const editionRef = db.collection("editions").doc(editionId);
    const editionSnap = await editionRef.get();
    if (!editionSnap.exists) {
      return NextResponse.json({ error: "Edição não encontrada." }, { status: 404 });
    }

    const cardsCol = editionRef.collection("cards");
    const qSnap = await cardsCol.where("publicNumberInt", "==", pn).limit(1).get();
    if (qSnap.empty) {
      return NextResponse.json({ error: "Cartela não encontrada nesta edição." }, { status: 404 });
    }

    const docSnap = qSnap.docs[0];
    const data = docSnap.data() as any;

    // Public payload: no buyer/vendor/sale info.
    const payload = {
      id: docSnap.id,
      publicNumberInt: Number(data.publicNumberInt ?? pn),
      printedNumber: String(data.printedNumber ?? ""),
      status: String(data.status ?? ""),
      numbers: Array.isArray(data.numbers) ? data.numbers.map((n: any) => Number(n)) : [],
      batch: data.batch ?? null,
      createdAt: data.createdAt ?? null,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    // Avoid leaking internal details
    return NextResponse.json({ error: "Não foi possível consultar agora." }, { status: 500 });
  }
}
