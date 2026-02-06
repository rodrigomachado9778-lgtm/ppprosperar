"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import type { Card } from "@/src/lib/prosperar/types";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";

export default function ImprimirCartelasPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const editionId = useMemo(() => {
    const v = (params as any)?.id;
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  }, [params]);

  const batch = useMemo(() => {
    const b = search.get("batch");
    return b ? Number(b) : null;
  }, [search]);

  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [roundsCount, setRoundsCount] = useState<number>(4);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // carrega config da edição (para imprimir o texto de rodadas)
      try {
        const edSnap = await getDoc(doc(db, "editions", editionId));
        const rc = Number((edSnap.data() as any)?.roundsCount ?? 4);
        setRoundsCount(Number.isFinite(rc) && rc > 0 ? rc : 4);
      } catch {
        setRoundsCount(4);
      }

      let qCards = query(collection(db, "editions", editionId, "cards"), orderBy("publicNumberInt", "asc"));
      if (batch && Number.isFinite(batch)) {
        qCards = query(collection(db, "editions", editionId, "cards"), where("batch", "==", batch), orderBy("publicNumberInt", "asc"));
      }
      const snap = await getDocs(qCards);
      const rows: Card[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setItems(rows);
      setLoading(false);
    }

    if (editionId) load().catch(() => setLoading(false));
  }, [editionId, batch]);

  return (
    <AdminGuard title="Impressão" subtitle={batch ? `Cartelas do lote ${batch}` : "Todas as cartelas"}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            disabled={loading || items.length === 0}
            onClick={() => window.print()}
          >
            {loading ? "Carregando..." : "Imprimir (Ctrl+P)"}
          </button>
          <p className="text-sm text-zinc-400">
            Dica: selecione “Salvar como PDF” na impressão para baixar o arquivo.
          </p>
        </div>

        <style jsx global>{`
          @media print {
            header, nav, button { display: none !important; }
            main { padding: 0 !important; }
            .print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            .card { break-inside: avoid; page-break-inside: avoid; }
          }
        `}</style>

        {loading ? (
          <p className="text-sm text-zinc-400">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma cartela encontrada.</p>
        ) : (
          <div className="print-grid">
            {items.map((c) => (
              <div key={c.id} className="card rounded-2xl bg-white p-4 text-black ring-1 ring-zinc-200">
                <div className="flex items-baseline justify-between">
                  <p className="text-lg font-bold">Cartela #{c.printedNumber ?? String(c.publicNumberInt ?? "")}</p>
                  <p className="text-xs text-zinc-600">Lote {c.batch}</p>
                </div>
                <p className="mt-1 text-xs text-zinc-600">Projeto Prosperar • 20 números • válido após cadastro (venda)</p>

                <div className="mt-3 grid grid-cols-5 gap-2">
                  {c.numbers.map((n) => (
                    <div key={n} className="flex h-10 items-center justify-center rounded-md border border-zinc-300 text-base font-semibold">
                      {n}
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-xs text-zinc-600">
                  Rodadas: {Array.from({ length: roundsCount }, (_, i) => i + 1).join(", ")}
                  {" "}
                  (mesmos números; cada rodada tem marcação independente).
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
