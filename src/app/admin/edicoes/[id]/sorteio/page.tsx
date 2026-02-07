"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";
import type { Edition, Round } from "@/src/lib/prosperar/types";
import { formatBRLFromCents, parseBRLCents, validateDrawNumber } from "@/src/lib/prosperar/format";

function RoundPill({ status }: { status: Round["status"] }) {
  const map: Record<Round["status"], string> = {
    READY: "bg-zinc-800 text-zinc-100 ring-zinc-700",
    RUNNING: "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30",
    CLOSED: "bg-purple-500/15 text-purple-100 ring-purple-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs ring-1 ${map[status]}`}>
      {status}
    </span>
  );
}

function ConfirmModal({
  open,
  number,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  number: number | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || number == null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        onClick={busy ? undefined : onCancel}
        aria-label="Fechar"
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 ring-1 ring-zinc-200 shadow-xl">
        <p className="text-sm text-zinc-600">Confirmação</p>
        <h3 className="mt-1 text-xl font-semibold text-zinc-100">
          Registrar o número <span className="text-emerald-300">{number}</span>?
        </h3>
        <p className="mt-2 text-sm text-zinc-600">
          Se você clicar em <b>Sim</b>, este número será gravado na rodada atual.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 ring-1 ring-zinc-200 hover:ring-zinc-700 disabled:opacity-60"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Registrando..." : "Sim, registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SorteioPage() {
  const params = useParams<{ id: string }>();
  const editionId = useMemo(() => {
    const v = (params as any)?.id;
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  }, [params]);

  const [edition, setEdition] = useState<Edition | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [cardsCount, setCardsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedRoundId, setSelectedRoundId] = useState("1");
  const selectedRound = rounds.find((r) => r.id === selectedRoundId) ?? null;

  const [numberInput, setNumberInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ✅ Confirmação antes de registrar número
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingNumber, setPendingNumber] = useState<number | null>(null);

  async function load() {
    setLoading(true);

    const edSnap = await getDoc(doc(db, "editions", editionId));
    if (!edSnap.exists()) {
      setEdition(null);
      setRounds([]);
      setCardsCount(0);
      setLoading(false);
      return;
    }
    setEdition({ id: edSnap.id, ...(edSnap.data() as any) });

    const rSnap = await getDocs(query(collection(db, "editions", editionId, "rounds"), orderBy("index", "asc")));
    const rRows: Round[] = rSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setRounds(rRows);

    // mantém a seleção se ainda existir
    setSelectedRoundId((prev) => (rRows.some((r) => r.id === prev) ? prev : rRows[0]?.id ?? "1"));

    const cSnap = await getDocs(query(collection(db, "editions", editionId, "cards"), where("status", "==", "VALIDATED")));
    setCardsCount(cSnap.size);

    setLoading(false);
  }

  useEffect(() => {
    if (!editionId) {
      setLoading(false);
      return;
    }
    load().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionId]);

  const canStartSelected = useMemo(() => {
    if (!edition || !selectedRound) return false;
    if (cardsCount <= 0) return false;
    const idx = selectedRound.index;
    const prevOk = rounds.filter((r) => r.index < idx).every((r) => r.status === "CLOSED");
    return prevOk && selectedRound.status === "READY";
  }, [edition, selectedRound, rounds, cardsCount]);

  const canMark = useMemo(() => {
    if (!edition || !selectedRound) return false;
    return selectedRound.status === "RUNNING";
  }, [edition, selectedRound]);

  async function setPrize(roundId: string, prizeText: string) {
    setErr(null);
    setMsg(null);
    if (!selectedRound) return;

    const prizeCents = parseBRLCents(prizeText);
    const round = rounds.find((r) => r.id === roundId);
    if (!round || round.status !== "READY") {
      setErr("Só é possível alterar o prêmio enquanto a rodada estiver READY.");
      return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, "editions", editionId, "rounds", roundId), { prizeCents });

      // ✅ Atualiza localmente (sem reload)
      setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, prizeCents } : r)));

      setMsg("Prêmio atualizado.");
    } catch {
      setErr("Não foi possível atualizar o prêmio.");
    } finally {
      setBusy(false);
    }
  }

  async function startRound() {
    setErr(null);
    setMsg(null);
    if (!edition || !selectedRound) return;
    if (!canStartSelected) return;

    setBusy(true);
    try {
      // Marca edição como RUNNING se ainda não estiver
      if (edition.status === "READY" || edition.status === "DRAFT") {
        await updateDoc(doc(db, "editions", editionId), { status: "RUNNING" });
        // Atualiza lock global (se existir)
        try {
          await updateDoc(doc(db, "config", "system"), { currentEditionStatus: "RUNNING" });
        } catch {
          // ignore
        }
        setEdition((prev) => (prev ? { ...prev, status: "RUNNING" as any } : prev));
      }

      await updateDoc(doc(db, "editions", editionId, "rounds", selectedRound.id), {
        status: "RUNNING",
        drawnNumbers: [],
        startedAt: serverTimestamp(),
      });

      // ✅ Atualiza localmente (sem reload)
      setRounds((prev) =>
        prev.map((r) =>
          r.id === selectedRound.id
            ? { ...r, status: "RUNNING", drawnNumbers: [] }
            : r,
        ),
      );

      await addEvent(selectedRound.id, { type: "ROUND_STARTED" });

      setMsg(`Rodada ${selectedRound.index} iniciada (zerada).`);
    } catch {
      setErr("Não foi possível iniciar a rodada. Verifique permissões e se existem cartelas cadastradas.");
    } finally {
      setBusy(false);
    }
  }

  async function addEvent(roundId: string, payload: any) {
    const ref = doc(collection(db, "editions", editionId, "rounds", roundId, "events"));
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  }

  function askConfirm(n: number) {
    setErr(null);
    setMsg(null);

    if (!selectedRound) return;

    const valid = validateDrawNumber(n);
    if (!valid.ok) {
      setErr(valid.message ?? "Número inválido.");
      return;
    }

    if (!canMark) {
      setErr("Rodada não está em andamento.");
      return;
    }

    if ((selectedRound.drawnNumbers ?? []).includes(n)) {
      setErr("Número já marcado nesta rodada.");
      return;
    }

    setPendingNumber(n);
    setConfirmOpen(true);
  }

  async function confirmAndRegister() {
    if (pendingNumber == null) return;
    const n = pendingNumber;
    setConfirmOpen(false);
    await addNumber(n);
  }

  async function addNumber(n: number) {
    setErr(null);
    setMsg(null);
    if (!selectedRound) return;

    const valid = validateDrawNumber(n);
    if (!valid.ok) {
      setErr(valid.message ?? "Número inválido.");
      return;
    }

    if (!canMark) {
      setErr("Rodada não está em andamento.");
      return;
    }

    setBusy(true);
    try {
      const roundRef = doc(db, "editions", editionId, "rounds", selectedRound.id);

      const nextDrawn = await runTransaction(db, async (tx) => {
        const snap = await tx.get(roundRef);
        if (!snap.exists()) throw new Error("Rodada não existe.");
        const data = snap.data() as any;

        if (data.status !== "RUNNING") throw new Error("Rodada não está em andamento.");

        const drawn: number[] = Array.isArray(data.drawnNumbers) ? data.drawnNumbers : [];
        if (drawn.includes(n)) throw new Error("Número já marcado nesta rodada.");

        const updated = [...drawn, n];
        tx.update(roundRef, { drawnNumbers: updated });
        return updated;
      });

      await addEvent(selectedRound.id, { type: "NUMBER_ADDED", number: n });

      // ✅ Atualiza localmente (sem recarregar)
      setRounds((prev) => prev.map((r) => (r.id === selectedRound.id ? { ...r, drawnNumbers: nextDrawn } : r)));

      // Checa ganhadores (após 20 números)
      if (nextDrawn.length >= 20) {
        const winners = await computeWinners(nextDrawn);
        if (winners.length > 0) {
          const closeInfo = await closeRound(winners, nextDrawn);

          // ✅ Reflete fechamento localmente (sem load)
          setRounds((prev) =>
            prev.map((r) =>
              r.id === selectedRound.id
                ? {
                    ...r,
                    status: "CLOSED",
                    winners,
                    winnersCount: winners.length,
                    prizePerWinnerCents: closeInfo.prizePerWinnerCents,
                    drawnNumbers: nextDrawn,
                  }
                : r,
            ),
          );

          if (selectedRound.index === 4) {
            setEdition((prev) => (prev ? { ...prev, status: "FINISHED" as any } : prev));
          }

          setMsg(`Rodada encerrada: ${winners.length} ganhador(es).`);
        } else {
          setMsg(`Número ${n} registrado.`);
        }
      } else {
        setMsg(`Número ${n} registrado.`);
      }

      setNumberInput("");
    } catch (e: any) {
      setErr(e?.message || "Não foi possível registrar o número.");
    } finally {
      setBusy(false);
      setPendingNumber(null);
    }
  }

  async function computeWinners(
    drawnNumbers: number[],
  ): Promise<{ cardId: string; printedNumber: string; publicNumberInt: number }[]> {
    const set = new Set(drawnNumbers);
    const snap = await getDocs(collection(db, "editions", editionId, "cards"));

    const winners: { cardId: string; printedNumber: string; publicNumberInt: number }[] = [];
    snap.forEach((d) => {
      const c = d.data() as any;
      if (c.status !== "VALIDATED") return;
      const nums: number[] = Array.isArray(c.numbers) ? c.numbers : [];
      if (nums.length !== 20) return;
      const ok = nums.every((x) => set.has(x));
      if (ok) {
        winners.push({
          cardId: d.id,
          printedNumber: String(c.printedNumber ?? c.publicNumberInt ?? d.id),
          publicNumberInt: Number(c.publicNumberInt ?? 0),
        });
      }
    });

    return winners;
  }

  async function closeRound(
    winners: { cardId: string; printedNumber: string; publicNumberInt: number }[],
    drawnNumbers: number[],
  ): Promise<{ prizePerWinnerCents: number }> {
    if (!selectedRound) return { prizePerWinnerCents: 0 };

    const roundRef = doc(db, "editions", editionId, "rounds", selectedRound.id);

    const info = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roundRef);
      if (!snap.exists()) throw new Error("Rodada não existe.");
      const data = snap.data() as any;

      const prizeCents = Number(data.prizeCents ?? 0);
      const per = winners.length > 0 ? Math.floor(prizeCents / winners.length) : 0;

      if (data.status !== "RUNNING") {
        // idempotente: já fechou
        return { prizePerWinnerCents: Number(data.prizePerWinnerCents ?? per) };
      }

      tx.update(roundRef, {
        status: "CLOSED",
        closedAt: serverTimestamp(),
        winners,
        winnersCount: winners.length,
        prizePerWinnerCents: per,
        drawnNumbers,
      });

      return { prizePerWinnerCents: per };
    });

    await addEvent(selectedRound.id, {
      type: "ROUND_CLOSED",
      winnersCount: winners.length,
      winners,
    });

    if (selectedRound.index === 4) {
      await updateDoc(doc(db, "editions", editionId), { status: "FINISHED" });
      // libera criação de nova edição
      try {
        await updateDoc(doc(db, "config", "system"), { currentEditionStatus: "FINISHED" });
      } catch {
        // ignore
      }
    }

    return info;
  }

  function onGridClick(n: number) {
    askConfirm(n);
  }

  function onMarkButton() {
    askConfirm(Number(numberInput));
  }

  return (
    <AdminGuard title="Sorteio" subtitle="Marque manualmente os números (1–50) conforme a live; cada rodada é independente">
      <ConfirmModal
        open={confirmOpen}
        number={pendingNumber}
        busy={busy}
        onCancel={() => {
          if (busy) return;
          setConfirmOpen(false);
          setPendingNumber(null);
        }}
        onConfirm={confirmAndRegister}
      />

      {loading ? (
        <p className="text-sm text-zinc-600">Carregando…</p>
      ) : !edition ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          Edição não encontrada.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-zinc-600">Edição</p>
                <p className="text-base font-semibold">{edition.name}</p>
                <p className="mt-1 text-sm text-zinc-600">
                  Status: {edition.status} • Cartelas: {cardsCount}
                </p>
              </div>

              <Link
                className="text-sm text-zinc-700 underline decoration-zinc-600 hover:text-zinc-100"
                href={`/admin/edicoes/${editionId}`}
              >
                Voltar
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <h2 className="text-base font-semibold">Rodadas</h2>
            <div className="mt-3 grid gap-2">
              {rounds.map((r) => (
                <button
                  key={r.id}
                  className={`flex items-center justify-between rounded-xl p-3 ring-1 ${
                    r.id === selectedRoundId ? "bg-zinc-900 ring-zinc-700" : "bg-zinc-100 ring-zinc-200 hover:ring-zinc-700"
                  }`}
                  onClick={() => setSelectedRoundId(r.id)}
                  type="button"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold">Rodada {r.index}</p>
                    <p className="text-xs text-zinc-600">Prêmio: {formatBRLFromCents(Number(r.prizeCents ?? 0))}</p>
                  </div>
                  <RoundPill status={r.status} />
                </button>
              ))}
            </div>
          </div>

          {selectedRound && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Rodada {selectedRound.index}</h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Status: {selectedRound.status} • Marcados: {selectedRound.drawnNumbers?.length ?? 0}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                    disabled={!canStartSelected || busy}
                    onClick={startRound}
                    type="button"
                  >
                    {busy ? "..." : "Iniciar (zerar)"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-xl bg-zinc-100 p-3 ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-600">Prêmio (editável só enquanto READY)</p>
                  <PrizeEditor
                    valueCents={Number(selectedRound.prizeCents ?? 0)}
                    disabled={busy || selectedRound.status !== "READY"}
                    onSave={(txt) => setPrize(selectedRound.id, txt)}
                  />
                </div>

                <div className="rounded-xl bg-zinc-100 p-3 ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-600">Registrar número</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="flex-1 rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                      placeholder="1 a 50"
                      value={numberInput}
                      onChange={(e) => setNumberInput(e.target.value)}
                      disabled={!canMark || busy}
                      inputMode="numeric"
                    />
                    <button
                      className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                      disabled={!canMark || busy}
                      onClick={onMarkButton}
                      type="button"
                    >
                      Marcar
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">
                    Dica: você também pode clicar na grade 1–50 abaixo (vai pedir confirmação).
                  </p>
                </div>

                {(err || msg) && (
                  <div
                    className={`rounded-xl p-3 text-sm ring-1 ${
                      err
                        ? "bg-red-500/10 text-red-200 ring-red-500/30"
                        : "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
                    }`}
                  >
                    {err ?? msg}
                  </div>
                )}

                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => {
                    const already = (selectedRound.drawnNumbers ?? []).includes(n);
                    const disabled = !canMark || busy || already;
                    return (
                      <button
                        key={n}
                        className={`rounded-xl px-0 py-3 text-sm font-semibold ring-1 ${
                          already
                            ? "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30"
                            : disabled
                            ? "bg-zinc-50 text-zinc-9000 ring-zinc-200"
                            : "bg-zinc-100 text-zinc-100 ring-zinc-200 hover:ring-zinc-700"
                        }`}
                        disabled={disabled}
                        onClick={() => onGridClick(n)}
                        type="button"
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-xl bg-zinc-100 p-3 ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-600">Números marcados (ordem)</p>
                  <p className="mt-2 text-sm">
                    {(selectedRound.drawnNumbers ?? []).length === 0 ? "—" : (selectedRound.drawnNumbers ?? []).join(" • ")}
                  </p>

                  {selectedRound.status === "CLOSED" && (
                    <div className="mt-3 rounded-xl bg-purple-500/10 p-3 text-sm text-purple-100 ring-1 ring-purple-500/30">
                      <p className="font-semibold">Rodada encerrada</p>
                      <p className="mt-1">
                        Ganhadores: {selectedRound.winnersCount ?? (selectedRound.winners?.length ?? 0)} • Valor por ganhador:{" "}
                        {formatBRLFromCents(Number(selectedRound.prizePerWinnerCents ?? 0))}
                      </p>
                      {selectedRound.winners?.length ? (
                        <ul className="mt-2 list-inside list-disc text-sm">
                          {selectedRound.winners.map((w) => (
                            <li key={w.cardId}>Cartela #{w.printedNumber}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminGuard>
  );
}

function PrizeEditor({
  valueCents,
  disabled,
  onSave,
}: {
  valueCents: number;
  disabled: boolean;
  onSave: (text: string) => void;
}) {
  const [txt, setTxt] = useState<string>(() => String((valueCents ?? 0) / 100).replace(".", ","));
  useEffect(() => {
    setTxt(String((valueCents ?? 0) / 100).replace(".", ","));
  }, [valueCents]);

  return (
    <div className="mt-2 flex gap-2">
      <input
        className="flex-1 rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        disabled={disabled}
        placeholder="Ex.: 500,00"
      />
      <button
        className="rounded-xl bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100 ring-1 ring-zinc-700 disabled:opacity-60"
        disabled={disabled}
        onClick={() => onSave(txt)}
        type="button"
      >
        Salvar
      </button>
    </div>
  );
}
