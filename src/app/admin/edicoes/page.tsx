"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";
import type { EditionStatus } from "@/src/lib/prosperar/types";
import { formatBRLFromCents, parseBRLCents } from "@/src/lib/prosperar/format";

type EditionRow = {
  id: string;
  name: string;
  status: EditionStatus;
  createdAt?: any;
};

function StatusPill({ status }: { status: EditionStatus }) {
  const map: Record<EditionStatus, string> = {
    DRAFT: "bg-zinc-800 text-zinc-100 ring-zinc-700",
    READY: "bg-sky-500/15 text-sky-100 ring-sky-500/30",
    RUNNING: "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30",
    FINISHED: "bg-purple-500/15 text-purple-100 ring-purple-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs ring-1 ${map[status]}`}>
      {status}
    </span>
  );
}

export default function AdminEditionsPage() {
  const [items, setItems] = useState<EditionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [system, setSystem] = useState<{ currentEditionId?: string | null; currentEditionStatus?: EditionStatus | null } | null>(null);

  const [name, setName] = useState("");
  // Preço da cartela (obrigatório)
  const [cardPrice, setCardPrice] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local
  // Prêmios por rodada (quantidade variável). Valores em BRL (string) para input.
  const [prizes, setPrizes] = useState<string[]>(["", "", "", ""]);

  // Duplicar edição
  const [dupFromId, setDupFromId] = useState<string>("");
  const [dupName, setDupName] = useState<string>("");
  const [dupCardPrice, setDupCardPrice] = useState<string>("");
  const [dupYoutubeUrl, setDupYoutubeUrl] = useState<string>("");
  const [dupScheduledAt, setDupScheduledAt] = useState<string>("");
  const [dupRoundsPreview, setDupRoundsPreview] = useState<{ roundsCount: number; prizesLabel: string[] } | null>(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupErr, setDupErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoadingList(true);

    // lock global (edição ativa)
    const sysSnap = await getDoc(doc(db, "config", "system"));
    setSystem(sysSnap.exists() ? (sysSnap.data() as any) : null);

    const q = query(collection(db, "editions"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const rows: EditionRow[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));
    setItems(rows);
    setLoadingList(false);
  }

  useEffect(() => {
    load().catch(() => setLoadingList(false));
  }, []);

  function setRoundsCount(nextCount: number) {
    const n = Math.max(1, Math.min(50, Math.floor(nextCount)));
    setPrizes((prev) => {
      const out = new Array(n).fill("") as string[];
      for (let i = 0; i < Math.min(prev.length, n); i++) out[i] = prev[i] ?? "";
      return out;
    });
  }

  async function loadDupPreview(editionId: string) {
    setDupRoundsPreview(null);
    setDupErr(null);
    if (!editionId) return;

    try {
      const edSnap = await getDoc(doc(db, "editions", editionId));
      if (!edSnap.exists()) {
        setDupErr("Edição não encontrada.");
        return;
      }
      const ed = edSnap.data() as any;
      const roundsQ = query(collection(db, "editions", editionId, "rounds"), orderBy("index", "asc"));
      const roundsSnap = await getDocs(roundsQ);
      const prizesLabel = roundsSnap.docs
        .map((d) => (d.data() as any)?.prizeCents ?? 0)
        .map((c: number) => formatBRLFromCents(Number(c) || 0));

      const roundsCount = Number(ed?.roundsCount) || Math.max(1, prizesLabel.length || 1);
      setDupRoundsPreview({ roundsCount, prizesLabel });

      // sugestões automáticas de nome e youtube
      if (!dupName.trim()) setDupName(`Cópia - ${ed?.name ?? editionId}`);
      if (!dupYoutubeUrl.trim() && ed?.youtubeUrl) setDupYoutubeUrl(String(ed.youtubeUrl));
      if (!dupCardPrice.trim() && (ed?.cardPriceCents ?? null) != null) {
        setDupCardPrice(formatBRLFromCents(Number(ed.cardPriceCents) || 0));
      }
    } catch {
      setDupErr("Não foi possível carregar a edição para duplicação.");
    }
  }

  const createBlockedReason = useMemo(() => {
    // Bloqueia criação se existir uma edição "ativa" (status != FINISHED)
    const st = system?.currentEditionStatus;
    if (st && st !== "FINISHED") return `A edição atual ainda não foi finalizada (${st}). Finalize para criar uma nova.`;

    // fallback: se não há system doc, tenta deduzir pela lista
    const anyOpen = items.some((x) => x.status !== "FINISHED");
    if (!system && anyOpen) return "Existe uma edição não finalizada. Finalize antes de criar outra.";
    return null;
  }, [system, items]);

  const canCreate = useMemo(() => {
    if (createBlockedReason) return false;
    const price = parseBRLCents(cardPrice) ?? 0;
    return name.trim().length >= 3 && prizes.length >= 1 && price > 0;
  }, [name, cardPrice, createBlockedReason, prizes.length]);

  async function onCreate() {
    setErr(null);
    if (!canCreate) return;

    const cardPriceCents = parseBRLCents(cardPrice) ?? 0;
    if (cardPriceCents <= 0) {
      setErr("Informe um preço válido para a cartela (maior que zero).");
      return;
    }

    setBusy(true);
    try {
      const sysRef = doc(db, "config", "system");
      const editionsCol = collection(db, "editions");

      await runTransaction(db, async (tx) => {
        const sysSnap = await tx.get(sysRef);
        if (sysSnap.exists()) {
          const st = (sysSnap.data() as any)?.currentEditionStatus as EditionStatus | undefined;
          if (st && st !== "FINISHED") {
            throw new Error("edition_not_finished");
          }
        }

        const newEdRef = doc(editionsCol);

        const youtube = youtubeUrl.trim();
        const sched = scheduledAt.trim();
        const schedDate = sched ? new Date(sched) : null;

        const roundsCount = Math.max(1, prizes.length);

        tx.set(newEdRef, {
          name: name.trim(),
          status: "READY" satisfies EditionStatus,
          cardPriceCents,
          youtubeUrl: youtube ? youtube : null,
          scheduledAt: schedDate ? schedDate : null,
          roundsCount,
          createdAt: serverTimestamp(),
          nextCardNumber: 1,
          nextBatch: 1,
          cardNumberMinDigits: 4,
        });

        // Cria N rodadas (1..N) com prêmio já configurado
        for (let i = 1; i <= roundsCount; i++) {
          const prizeCents = parseBRLCents(prizes[i - 1] ?? "") ?? 0;
          const rRef = doc(db, "editions", newEdRef.id, "rounds", String(i));
          tx.set(rRef, {
            index: i,
            prizeCents,
            status: "READY",
            drawnNumbers: [],
            createdAt: serverTimestamp(),
          });
        }

        // lock global
        tx.set(
          sysRef,
          {
            currentEditionId: newEdRef.id,
            currentEditionStatus: "READY" satisfies EditionStatus,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });

      setName("");
      setCardPrice("");
      setYoutubeUrl("");
      setScheduledAt("");
      setPrizes(["", "", "", ""]);
      await load();
    } catch (e: any) {
      if (String(e?.message ?? "").includes("edition_not_finished")) {
        setErr("Você só pode criar uma nova edição quando a edição anterior estiver FINALIZADA.");
      } else {
        setErr("Não foi possível criar a edição. Verifique permissões e conexão.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDuplicate() {
    setDupErr(null);
    if (!dupFromId) return;
    if (!dupName.trim() || dupName.trim().length < 3) {
      setDupErr("Informe um nome para a nova edição.");
      return;
    }
    const dupPriceCents = parseBRLCents(dupCardPrice) ?? 0;
    if (dupPriceCents <= 0) {
      setDupErr("Informe um preço válido para a cartela (maior que zero).");
      return;
    }
    if (createBlockedReason) {
      setDupErr("Você só pode duplicar quando a edição anterior estiver FINALIZADA.");
      return;
    }

    setDupBusy(true);
    try {
      const sysRef = doc(db, "config", "system");
      const editionsCol = collection(db, "editions");
      const sourceEdRef = doc(db, "editions", dupFromId);

      await runTransaction(db, async (tx) => {
        const sysSnap = await tx.get(sysRef);
        if (sysSnap.exists()) {
          const st = (sysSnap.data() as any)?.currentEditionStatus as EditionStatus | undefined;
          if (st && st !== "FINISHED") throw new Error("edition_not_finished");
        }

        const srcSnap = await tx.get(sourceEdRef);
        if (!srcSnap.exists()) throw new Error("source_not_found");
        const src = srcSnap.data() as any;

        const roundsCount = Number(src?.roundsCount) || 1;

        // lê as rodadas (1..N)
        const srcPrizes: number[] = [];
        for (let i = 1; i <= roundsCount; i++) {
          const rRef = doc(db, "editions", dupFromId, "rounds", String(i));
          const rSnap = await tx.get(rRef);
          const prizeCents = rSnap.exists() ? Number((rSnap.data() as any)?.prizeCents ?? 0) : 0;
          srcPrizes.push(Number.isFinite(prizeCents) ? prizeCents : 0);
        }

        const newEdRef = doc(editionsCol);
        const youtube = dupYoutubeUrl.trim();
        const sched = dupScheduledAt.trim();
        const schedDate = sched ? new Date(sched) : null;

        tx.set(newEdRef, {
          name: dupName.trim(),
          status: "READY" satisfies EditionStatus,
          cardPriceCents: dupPriceCents,
          youtubeUrl: youtube ? youtube : null,
          scheduledAt: schedDate ? schedDate : null,
          roundsCount,
          createdAt: serverTimestamp(),
          nextCardNumber: 1,
          nextBatch: 1,
          cardNumberMinDigits: src?.cardNumberMinDigits ?? 4,
        });

        for (let i = 1; i <= roundsCount; i++) {
          const rRef = doc(db, "editions", newEdRef.id, "rounds", String(i));
          tx.set(rRef, {
            index: i,
            prizeCents: srcPrizes[i - 1] ?? 0,
            status: "READY",
            drawnNumbers: [],
            createdAt: serverTimestamp(),
          });
        }

        tx.set(
          sysRef,
          {
            currentEditionId: newEdRef.id,
            currentEditionStatus: "READY" satisfies EditionStatus,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });

      setDupFromId("");
      setDupName("");
      setDupCardPrice("");
      setDupYoutubeUrl("");
      setDupScheduledAt("");
      setDupRoundsPreview(null);
      await load();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("edition_not_finished")) {
        setDupErr("Você só pode duplicar uma edição quando a edição anterior estiver FINALIZADA.");
      } else if (msg.includes("source_not_found")) {
        setDupErr("Edição de origem não encontrada.");
      } else {
        setDupErr("Não foi possível duplicar a edição. Verifique permissões e conexão.");
      }
    } finally {
      setDupBusy(false);
    }
  }

  return (
    <AdminGuard title="Edições" subtitle="Criar e gerenciar edições do Projeto Prosperar">
      <div className="space-y-6">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <h2 className="text-base font-semibold">Atalhos</h2>
          <p className="mt-1 text-sm text-zinc-600">Crie rapidamente usando um modelo de rodadas ou duplique uma edição existente.</p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-white/40 p-3 ring-1 ring-zinc-200">
              <p className="text-sm font-semibold">Modelos de rodadas</p>
              <p className="mt-1 text-xs text-zinc-600">Ajusta a quantidade de rodadas no formulário abaixo (mantém os valores já digitados quando possível).</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-800/80"
                    onClick={() => setRoundsCount(n)}
                  >
                    {n} rodadas
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white/40 p-3 ring-1 ring-zinc-200">
              <p className="text-sm font-semibold">Duplicar edição</p>
              <p className="mt-1 text-xs text-zinc-600">Cria uma nova edição copiando as rodadas e prêmios. Você altera nome, data e YouTube.</p>

              <div className="mt-3 grid gap-2">
                <select
                  className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                  value={dupFromId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDupFromId(id);
                    loadDupPreview(id);
                  }}
                >
                  <option value="">Selecione uma edição…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.status})
                    </option>
                  ))}
                </select>

                <input
                  className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                  placeholder="Nome da nova edição"
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                />

                <div>
                  <p className="text-xs text-zinc-600">Preço da cartela (obrigatório)</p>
                  <input
                    className="mt-2 w-full rounded-xl bg-zinc-100 px-3 py-3 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                    placeholder="Ex.: 10,00"
                    value={dupCardPrice}
                    onChange={(e) => setDupCardPrice(e.target.value)}
                  />
                </div>

                <input
                  className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                  placeholder="Link do YouTube (opcional)"
                  value={dupYoutubeUrl}
                  onChange={(e) => setDupYoutubeUrl(e.target.value)}
                />

                <div>
                  <p className="text-xs text-zinc-600">Data/hora do sorteio (opcional)</p>
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-xl bg-zinc-100 px-3 py-3 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                    value={dupScheduledAt}
                    onChange={(e) => setDupScheduledAt(e.target.value)}
                  />
                </div>

                {dupRoundsPreview && (
                  <div className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-700 ring-1 ring-zinc-200">
                    <p className="font-semibold">Prévia</p>
                    <p className="mt-1 text-zinc-600">Rodadas: {dupRoundsPreview.roundsCount}</p>
                    {dupRoundsPreview.prizesLabel.length > 0 && (
                      <p className="mt-1 text-zinc-600">
                        Prêmios: {dupRoundsPreview.prizesLabel.slice(0, 6).join(" • ")}
                        {dupRoundsPreview.prizesLabel.length > 6 ? " …" : ""}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                    disabled={!dupFromId || dupBusy || !!createBlockedReason}
                    onClick={onDuplicate}
                  >
                    {dupBusy ? "Duplicando…" : "Duplicar"}
                  </button>
                </div>

                {dupErr && (
                  <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">
                    {dupErr}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <h2 className="text-base font-semibold">Nova edição</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Só é possível criar uma nova edição quando a anterior estiver <b>FINISHED</b>. Você escolhe quantas rodadas deseja.
          </p>

          {createBlockedReason && (
            <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-amber-500/30">
              {createBlockedReason}
            </p>
          )}

          <div className="mt-4 grid gap-3">
            <input
              className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
              placeholder='Nome (ex.: "Prosperar - Fevereiro/2026")'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div>
              <p className="text-xs text-zinc-600">Preço da cartela (obrigatório)</p>
              <input
                className="mt-2 w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                placeholder="Ex.: 10,00"
                value={cardPrice}
                onChange={(e) => setCardPrice(e.target.value)}
              />
            </div>

            <input
              className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
              placeholder="Link do YouTube (opcional)"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />

            <div>
              <p className="text-xs text-zinc-600">Data/hora do sorteio (opcional)</p>
              <input
                type="datetime-local"
                className="mt-2 w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>

            <div className="rounded-2xl bg-white/40 p-3 ring-1 ring-zinc-200">
              <p className="text-sm font-semibold">Prêmios por rodada</p>
              <p className="mt-1 text-xs text-zinc-600">Digite em reais (ex.: 250,00). Se vazio, fica 0. Você pode adicionar/remover rodadas.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-800/80"
                  onClick={() => setPrizes((prev) => [...prev, ""])}
                >
                  + Adicionar rodada
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-800/80 disabled:opacity-60"
                  disabled={prizes.length <= 1}
                  onClick={() => setPrizes((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)))}
                >
                  − Remover última
                </button>
                <span className="text-xs text-zinc-600">Total: {prizes.length} rodada(s)</span>
              </div>
              <div className="mt-3 grid gap-2">
                {prizes.map((v, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-24 text-xs text-zinc-600">Rodada {idx + 1}</span>
                    <input
                      className="flex-1 rounded-xl bg-zinc-100 px-3 py-2 text-sm outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                      placeholder="R$ 0,00"
                      value={v}
                      onChange={(e) =>
                        setPrizes((prev) => {
                          const next = [...prev];
                          next[idx] = e.target.value;
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={!canCreate || busy}
                onClick={onCreate}
              >
                {busy ? "Criando..." : "Criar"}
              </button>
            </div>
          </div>

          {err && (
            <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">
              {err}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Edições</h2>
            <Link className="text-sm text-zinc-700 underline decoration-zinc-600 hover:text-zinc-100" href="/resultado">
              Consulta pública
            </Link>
          </div>

          {loadingList ? (
            <p className="mt-3 text-sm text-zinc-600">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">Nenhuma edição criada ainda.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {items.map((it) => (
                <Link
                  key={it.id}
                  href={`/admin/edicoes/${it.id}`}
                  className="flex items-center justify-between rounded-xl bg-zinc-100 p-3 ring-1 ring-zinc-200 hover:ring-zinc-700"
                >
                  <div>
                    <p className="text-sm font-semibold">{it.name}</p>
                    <p className="text-xs text-zinc-600">ID: {it.id}</p>
                  </div>
                  <StatusPill status={it.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}
