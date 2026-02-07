"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

import { db } from "@/src/lib/firebase/client";
import type { Edition, Round, Card } from "@/src/lib/prosperar/types";
import { formatBRLFromCents } from "@/src/lib/prosperar/format";
import { AppShell } from "@/src/components/AppShell";

type LookupCard = {
  publicNumberInt: number;
  printedNumber: string;
  status: string;
};

export default function ResultadoPage() {
  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionId, setEditionId] = useState<string>("");
  const [rounds, setRounds] = useState<Round[]>([]);

  // Public lookup (Option B): CPF + telefone
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [buyerName, setBuyerName] = useState<string>("");
  const [myCards, setMyCards] = useState<LookupCard[] | null>(null);

  // Optional: expand a specific card
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedPublicNumber, setSelectedPublicNumber] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const snap = await getDocs(query(collection(db, "editions"), orderBy("createdAt", "desc")));
      const rows: Edition[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setEditions(rows);
      setEditionId(rows[0]?.id ?? "");
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!editionId) return;
    (async () => {
      const rSnap = await getDocs(query(collection(db, "editions", editionId, "rounds"), orderBy("index", "asc")));
      const rRows: Round[] = rSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setRounds(rRows);
      setSelectedCard(null);
      setSelectedPublicNumber(null);
    })().catch(() => setRounds([]));
  }, [editionId]);

  const selectedEdition = useMemo(() => editions.find((e) => e.id === editionId) ?? null, [editions, editionId]);

  const drawnSets = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const r of rounds) m.set(r.id, new Set(r.drawnNumbers ?? []));
    return m;
  }, [rounds]);

  const perRound = useMemo(() => {
    if (!selectedCard) return [];
    return rounds.map((r) => {
      const set = drawnSets.get(r.id) ?? new Set<number>();
      const hits = selectedCard.numbers.filter((n) => set.has(n)).length;
      const isWinner = (r.winners ?? []).some((w) => Number(w.publicNumberInt ?? 0) === Number(selectedCard.publicNumberInt ?? 0));
      return {
        round: r,
        hits,
        missing: selectedCard.numbers.filter((n) => !set.has(n)),
        isWinner,
      };
    });
  }, [selectedCard, rounds, drawnSets]);

  const hasAnyResult = useMemo(() => {
    // If at least one round moved from READY, we consider results "published"
    return rounds.some((r) => String(r.status ?? "READY") !== "READY");
  }, [rounds]);

  async function onLookupMyCards() {
    setErr(null);
    setBusy(true);
    setSelectedCard(null);
    setSelectedPublicNumber(null);
    setMyCards(null);
    setBuyerName("");

    try {
      if (!editionId) {
        setErr("Nenhuma edição disponível.");
        return;
      }

      const res = await fetch("/api/public/resultado", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editionId, phone, cpf }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String(data?.error ?? "Não foi possível consultar agora."));
        return;
      }
      setBuyerName(String(data?.buyer?.name ?? ""));
      setMyCards(Array.isArray(data?.cards) ? (data.cards as LookupCard[]) : []);
    } catch {
      setErr("Não foi possível consultar agora.");
    } finally {
      setBusy(false);
    }
  }

  async function onOpenCard(publicNumberInt: number) {
    setErr(null);
    setBusy(true);
    setSelectedPublicNumber(publicNumberInt);
    setSelectedCard(null);
    try {
      const res = await fetch(
        `/api/public/card?editionId=${encodeURIComponent(editionId)}&publicNumberInt=${encodeURIComponent(String(publicNumberInt))}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String(data?.error ?? "Cartela não encontrada."));
        return;
      }
      setSelectedCard(data as any);
    } catch {
      setErr("Não foi possível consultar a cartela agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Resultados" showLogout={false}>
      {loading ? (
        <p className="text-sm text-zinc-600">Carregando…</p>
      ) : editions.length === 0 ? (
        <p className="text-sm text-zinc-600">Nenhuma edição disponível.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full">
                <p className="text-xs text-zinc-600">Edição</p>
                <select
                  className="mt-2 w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                  value={editionId}
                  onChange={(e) => {
                    setEditionId(e.target.value);
                    setMyCards(null);
                    setBuyerName("");
                    setSelectedCard(null);
                    setSelectedPublicNumber(null);
                  }}
                >
                  {editions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.status})
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-zinc-600">
                  Digite seu CPF e telefone para ver as cartelas compradas nesta edição.
                </p>
              </div>

              <Link className="text-sm text-zinc-700 underline decoration-zinc-600 hover:text-zinc-100" href="/admin/edicoes">
                Área admin
              </Link>
            </div>
          </div>

          {selectedEdition?.youtubeUrl && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <p className="text-sm font-semibold">Live do sorteio</p>
              <p className="mt-1 text-sm text-zinc-600">
                {selectedEdition.scheduledAt ? "Sorteio previsto" : "Link"}
                {selectedEdition.scheduledAt ? ": " : ": "}
                {selectedEdition.scheduledAt
                  ? new Date((selectedEdition as any).scheduledAt?.toDate?.() ?? selectedEdition.scheduledAt).toLocaleString("pt-BR")
                  : null}
              </p>
              <a
                className="mt-3 inline-flex rounded-xl bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 ring-1 ring-sky-500/30 hover:ring-sky-400/40"
                href={selectedEdition.youtubeUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no YouTube
              </a>
            </div>
          )}

          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <p className="text-sm font-semibold">Minhas cartelas</p>
            <div className="mt-3 grid gap-2">
              <input
                className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                placeholder="Telefone (DDD + número) — ex.: 11999999999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <input
                className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                placeholder="CPF — ex.: 123.456.789-09"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
              />

              <button
                className="mt-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={busy}
                onClick={onLookupMyCards}
              >
                {busy ? "Consultando..." : "Consultar"}
              </button>
            </div>

            {err && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">{err}</p>}
          </div>

          {myCards && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                <p className="text-sm text-zinc-600">Comprador</p>
                <p className="text-lg font-semibold">{buyerName || "—"}</p>
                <p className="mt-2 text-sm text-zinc-600">
                  {hasAnyResult ? "Resultados disponíveis para conferência." : "Ainda não há resultado publicado. Você pode confirmar que suas cartelas estão ativas nesta edição."}
                </p>
              </div>

              {myCards.length === 0 ? (
                <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-200 ring-1 ring-amber-500/30">
                  Nenhuma cartela encontrada para este CPF + telefone nesta edição.
                </div>
              ) : (
                <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                  <p className="text-sm font-semibold">Cartelas encontradas ({myCards.length})</p>
                  <div className="mt-3 grid gap-2">
                    {myCards.map((c) => (
                      <div key={c.publicNumberInt} className="flex items-center justify-between gap-3 rounded-xl bg-white/40 p-3 ring-1 ring-zinc-200">
                        <div>
                          <p className="text-sm font-semibold">#{c.printedNumber || String(c.publicNumberInt)}</p>
                          <p className="text-xs text-zinc-600">Status: {c.status || "—"}</p>
                        </div>
                        <button
                          className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-semibold hover:bg-zinc-700 disabled:opacity-60"
                          disabled={busy}
                          onClick={() => onOpenCard(c.publicNumberInt)}
                        >
                          Ver cartela
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedPublicNumber != null && selectedCard && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                <p className="text-sm text-zinc-600">Cartela</p>
                <p className="text-lg font-semibold">#{selectedCard.printedNumber ?? String(selectedCard.publicNumberInt ?? "")}</p>
                <p className="mt-2 text-sm text-zinc-700">Números: {selectedCard.numbers.join(", ")}</p>
              </div>

              {perRound.map(({ round, hits, missing, isWinner }) => (
                <div key={round.id} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">Rodada {round.index}</p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Status: {round.status} • Prêmio: {formatBRLFromCents(Number(round.prizeCents ?? 0))}
                      </p>
                    </div>

                    {isWinner && (
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/30">
                        GANHOU
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2">
                    <p className="text-sm text-zinc-700">
                      Acertos: <span className="font-semibold">{hits}/20</span>
                    </p>

                    {round.status !== "READY" && (
                      <p className="text-xs text-zinc-600">
                        Números sorteados: {(round.drawnNumbers ?? []).length ? (round.drawnNumbers ?? []).join(" • ") : "—"}
                      </p>
                    )}

                    {round.status === "CLOSED" && (
                      <p className="text-sm text-zinc-700">
                        Valor por ganhador: <span className="font-semibold">{formatBRLFromCents(Number(round.prizePerWinnerCents ?? 0))}</span>
                      </p>
                    )}

                    {!isWinner && round.status !== "READY" && missing.length > 0 && (
                      <p className="text-xs text-zinc-600">Faltando: {missing.join(", ")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
