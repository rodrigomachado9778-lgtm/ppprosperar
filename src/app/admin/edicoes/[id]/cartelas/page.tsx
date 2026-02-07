"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";
import type { Card, Edition } from "@/src/lib/prosperar/types";

function sample20(): number[] {
  // 20 números únicos de 1..50
  const pool = Array.from({ length: 50 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 20).sort((a, b) => a - b);
}

export default function CartelasPage() {
  const params = useParams<{ id: string }>();
  const editionId = useMemo(() => {
    const v = (params as any)?.id;
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  }, [params]);

  const [edition, setEdition] = useState<Edition | null>(null);
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  // Regra operacional: cada lote tem no máximo 50 cartelas.
  const [qty, setQty] = useState(50);
  const [batchFilter, setBatchFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "GENERATED" | "AVAILABLE" | "VALIDATED">("all");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canGenerate = edition?.status !== "RUNNING" && edition?.status !== "FINISHED";

  async function load() {
    setLoading(true);
    const edSnap = await getDoc(doc(db, "editions", editionId));
    if (!edSnap.exists()) {
      setEdition(null);
      setItems([]);
      setLoading(false);
      return;
    }
    const ed = { id: edSnap.id, ...(edSnap.data() as any) } as Edition;
    setEdition(ed);

    let qCards = query(collection(db, "editions", editionId, "cards"), orderBy("createdAt", "desc"));

    if (statusFilter !== "all") {
      qCards = query(collection(db, "editions", editionId, "cards"), where("status", "==", statusFilter), orderBy("createdAt", "desc"));
    }
    if (batchFilter !== "all") {
      qCards = query(collection(db, "editions", editionId, "cards"), where("batch", "==", batchFilter), orderBy("createdAt", "desc"));
      if (statusFilter !== "all") {
        qCards = query(
          collection(db, "editions", editionId, "cards"),
          where("status", "==", statusFilter),
          where("batch", "==", batchFilter),
          orderBy("createdAt", "desc")
        );
      }
    }

    const snap = await getDocs(qCards);
    const rows: Card[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setItems(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (!editionId) {
      setLoading(false);
      return;
    }
    load().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionId, statusFilter, batchFilter]);

  const batches = useMemo(() => {
    const set = new Set<number>();
    for (const c of items) set.add(c.batch);
    return Array.from(set).sort((a, b) => a - b);
  }, [items]);

  async function onGenerate() {
    setErr(null);
    if (!edition) return;
    if (!canGenerate) {
      setErr("Não é permitido gerar cartelas com a edição em andamento/finalizada.");
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Informe uma quantidade válida.");
      return;
    }
    if (n > 50) {
      setErr("Cada lote pode ter no máximo 50 cartelas.");
      return;
    }

    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const edRef = doc(db, "editions", editionId);
        const edSnap = await tx.get(edRef);
        if (!edSnap.exists()) throw new Error("edition_not_found");

        const ed = edSnap.data() as any;
        const startNum = typeof ed.nextCardNumber === "number" ? ed.nextCardNumber : 1;
        const minDigits = typeof ed.cardNumberMinDigits === "number" ? ed.cardNumberMinDigits : 4;
        const batch = typeof ed.nextBatch === "number" ? ed.nextBatch : 1;

        // reserva faixa de numeração + próximo lote
        tx.update(edRef, {
          nextCardNumber: startNum + n,
          nextBatch: batch + 1,
        });

        const cardsCol = collection(db, "editions", editionId, "cards");
        for (let i = 0; i < n; i++) {
          const publicNumberInt = startNum + i;
          const printedNumber = String(publicNumberInt).padStart(minDigits, "0");
          const cardRef = doc(cardsCol); // id aleatório
          tx.set(cardRef, {
            publicNumberInt,
            printedNumber,
            numbers: sample20(),
            status: "GENERATED",
            batch,
            createdAt: serverTimestamp(),
          });
        }
      });

      await load();
    } catch (e: any) {
      setErr("Não foi possível gerar as cartelas. Verifique permissões e conexão.");
    } finally {
      setBusy(false);
    }
  }

  function openPrint() {
    const url = `/admin/edicoes/${editionId}/cartelas/imprimir${batchFilter === "all" ? "" : `?batch=${batchFilter}`}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <AdminGuard title="Cartelas" subtitle="Gere lotes, imprima e acompanhe validações (venda)">
      {loading ? (
        <p className="text-sm text-zinc-600">Carregando…</p>
      ) : !edition ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">Edição não encontrada.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-zinc-600">Edição</p>
                <p className="text-base font-semibold">{edition.name}</p>
                <p className="mt-1 text-sm text-zinc-600">Status: {edition.status}</p>
                <p className="mt-1 text-xs text-zinc-9000">
                  Regras: cada cartela tem 20 números (1–50). As {edition.roundsCount ?? 4} rodada(s) são independentes e usam os mesmos 20 números.
                </p>
              </div>

              <Link className="text-sm text-zinc-700 underline decoration-zinc-600 hover:text-zinc-100" href={`/admin/edicoes/${editionId}`}>
                Voltar
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <h2 className="text-base font-semibold">Gerar lote de cartelas</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Gere cartelas automaticamente. Elas só entram no sorteio depois de <span className="text-zinc-200">validadas</span> pelo vendedor.
            </p>

            {!canGenerate && (
              <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                Edição em andamento/finalizada: geração de cartelas está bloqueada.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <input
                type="number"
                min={1}
                max={50}
                className="w-40 rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                disabled={!canGenerate || busy}
              />
              <button
                className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={!canGenerate || busy}
                onClick={onGenerate}
              >
                {busy ? "Gerando..." : "Gerar lote"}
              </button>

              <button
                className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 ring-1 ring-zinc-200 hover:ring-zinc-700 disabled:opacity-60"
                disabled={items.length === 0}
                onClick={openPrint}
                title="Abre uma página pronta para impressão (use Ctrl+P)"
              >
                Imprimir
              </button>
            </div>

            {err && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">{err}</p>}
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Cartelas</h2>
                <p className="mt-1 text-sm text-zinc-600">Total exibido: {items.length}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl bg-zinc-100 px-3 py-2 text-sm outline-none ring-1 ring-zinc-200"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                  <option value="all">Status: todos</option>
                  <option value="GENERATED">Somente geradas (não liberadas)</option>
                  <option value="AVAILABLE">Somente disponíveis (lote liberado)</option>
                  <option value="VALIDATED">Somente validadas</option>
                </select>

                <select
                  className="rounded-xl bg-zinc-100 px-3 py-2 text-sm outline-none ring-1 ring-zinc-200"
                  value={batchFilter === "all" ? "all" : String(batchFilter)}
                  onChange={(e) => setBatchFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                >
                  <option value="all">Lote: todos</option>
                  {batches.map((b) => (
                    <option key={b} value={String(b)}>
                      Lote {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Nenhuma cartela encontrada com os filtros atuais.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {items.slice(0, 200).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-zinc-100 p-3 ring-1 ring-zinc-200"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        Cartela #{c.printedNumber ?? String(c.publicNumberInt ?? "")} <span className="text-xs text-zinc-9000">(lote {c.batch})</span>
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">Status: {c.status}</p>
                      <p className="mt-1 text-xs text-zinc-600">Números: {c.numbers.join(", ")}</p>
                    </div>
                  </div>
                ))}
                {items.length > 200 && (
                  <p className="text-xs text-zinc-9000">Mostrando as 200 mais recentes. Use filtros para refinar.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
