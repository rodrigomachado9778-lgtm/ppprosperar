"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  scheduledAt?: any;
  cardPriceCents?: number;
  roundsCount?: number;
};

function statusLabel(status: EditionStatus): string {
  switch (status) {
    case "DRAFT":
      return "Rascunho";
    case "READY":
      return "Pronta";
    case "RUNNING":
      return "Em andamento";
    case "FINISHED":
      return "Finalizada";
  }
}

function StatusPill({ status }: { status: EditionStatus }) {
  const map: Record<EditionStatus, string> = {
    DRAFT: "bg-zinc-800 text-zinc-100 ring-zinc-700",
    READY: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
    RUNNING: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30",
    FINISHED: "bg-purple-500/15 text-purple-700 ring-purple-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${map[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {statusLabel(status)}
    </span>
  );
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDateTime(value: any): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Card({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "muted" | "warning";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-500/10 ring-amber-500/30"
      : tone === "muted"
        ? "bg-zinc-100 ring-zinc-200"
        : "bg-white ring-zinc-200";
  return (
    <section className={`rounded-2xl p-4 ring-1 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  // Fecha com ESC
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        // clique no backdrop
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            Fechar
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function AdminEditionsPage() {
  const [items, setItems] = useState<EditionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [system, setSystem] = useState<{
    currentEditionId?: string | null;
    currentEditionStatus?: EditionStatus | null;
  } | null>(null);

  // Modal criar
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Criar
  const [name, setName] = useState("");
  const [cardPrice, setCardPrice] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local
  const [prizes, setPrizes] = useState<string[]>(["", "", "", ""]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function resetCreateForm() {
    setCreateStep(1);
    setErr(null);
    setName("");
    setCardPrice("");
    setYoutubeUrl("");
    setScheduledAt("");
    setPrizes(["", "", "", ""]);
  }

  function normalizeMoneyInput(v: string): string {
    const cents = parseBRLCents(v);
    if (!cents || cents <= 0) return v.trim();
    return formatBRLFromCents(cents).replace(/^R\$\s?/, "");
  }

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

  // Autofoco quando abre
  useEffect(() => {
    if (!createOpen) return;
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [createOpen]);

  function setRoundsCount(nextCount: number) {
    const n = Math.max(1, Math.min(50, Math.floor(nextCount)));
    setPrizes((prev) => {
      const out = new Array(n).fill("") as string[];
      for (let i = 0; i < Math.min(prev.length, n); i++) out[i] = prev[i] ?? "";
      return out;
    });
  }

  const currentEdition = useMemo(() => {
    const id = system?.currentEditionId;
    if (!id) return null;
    return items.find((x) => x.id === id) ?? null;
  }, [items, system?.currentEditionId]);

  const createBlockedReason = useMemo(() => {
    const st = system?.currentEditionStatus;
    if (st && st !== "FINISHED") return `A edição atual ainda não foi finalizada (${statusLabel(st)}). Finalize para criar uma nova.`;

    const anyOpen = items.some((x) => x.status !== "FINISHED");
    if (!system && anyOpen) return "Existe uma edição não finalizada. Finalize antes de criar outra.";
    return null;
  }, [system, items]);

  const basicValid = useMemo(() => {
    if (createBlockedReason) return false;
    const price = parseBRLCents(cardPrice) ?? 0;
    return name.trim().length >= 3 && price > 0;
  }, [name, cardPrice, createBlockedReason]);

  const prizesValid = useMemo(() => {
    if (createBlockedReason) return false;
    if (prizes.length < 1) return false;
    // profissional: cada rodada precisa ter um valor (pode ser 0,00)
    return prizes.every((p) => {
      const t = (p ?? "").trim();
      if (!t) return false;
      return (parseBRLCents(t) ?? 0) >= 0;
    });
  }, [prizes, createBlockedReason]);

  const canCreate = useMemo(() => basicValid && prizesValid, [basicValid, prizesValid]);

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
          if (st && st !== "FINISHED") throw new Error("edition_not_finished");
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

      resetCreateForm();
      await load();
      setCreateOpen(false);
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

  const totals = useMemo(() => {
    const total = items.length;
    const open = items.filter((x) => x.status !== "FINISHED").length;
    const finished = items.filter((x) => x.status === "FINISHED").length;
    return { total, open, finished };
  }, [items]);

  const nextSteps = useMemo(() => {
    if (!currentEdition) {
      return [{ label: "Criar sua primeira edição", href: "#" }];
    }
    if (currentEdition.status === "READY") {
      return [
        { label: "Gerenciar cartelas", href: "/admin/cartelas" },
        { label: "Ir para sorteio", href: "/admin/sorteio" },
      ];
    }
    if (currentEdition.status === "RUNNING") {
      return [
        { label: "Acompanhar sorteio", href: "/admin/sorteio" },
        { label: "Abrir detalhes da edição", href: `/admin/edicoes/${currentEdition.id}` },
      ];
    }
    if (currentEdition.status === "FINISHED") {
      return [
        { label: "Criar nova edição", href: "#" },
        { label: "Ver histórico", href: "/admin/edicoes/historico" },
      ];
    }
    return [{ label: "Abrir edição", href: `/admin/edicoes/${currentEdition.id}` }];
  }, [currentEdition]);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Edições</h1>
            <p className="mt-1 text-sm text-zinc-600">Crie e acompanhe a edição atual. O histórico fica em uma tela separada.</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/admin/edicoes/historico"
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
            >
              Ver histórico
            </Link>

            <button
              type="button"
              onClick={() => {
                setErr(null);
                setCreateStep(1);
                setCreateOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!!createBlockedReason}
              title={createBlockedReason ?? "Criar nova edição"}
            >
              Nova edição
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title="Total" description="Edições cadastradas" tone="muted">
            <div className="text-2xl font-semibold tabular-nums">{loadingList ? "—" : totals.total}</div>
          </Card>
          <Card title="Abertas" description="Ainda não finalizadas" tone="muted">
            <div className="text-2xl font-semibold tabular-nums">{loadingList ? "—" : totals.open}</div>
          </Card>
          <Card title="Finalizadas" description="Encerradas com sucesso" tone="muted">
            <div className="text-2xl font-semibold tabular-nums">{loadingList ? "—" : totals.finished}</div>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card
            title="Edição atual"
            description="A edição ativa é a que controla geração de cartelas e sorteio."
            tone={currentEdition?.status && currentEdition.status !== "FINISHED" ? "default" : "muted"}
          >
            {currentEdition ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{currentEdition.name}</div>
                    <div className="mt-1 text-xs text-zinc-600">ID: {currentEdition.id}</div>
                  </div>
                  <StatusPill status={currentEdition.status} />
                </div>

                <div className="grid grid-cols-1 gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                  <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="text-xs text-zinc-500">Criada em</div>
                    <div className="mt-0.5 font-medium">{formatDateTime(currentEdition.createdAt)}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="text-xs text-zinc-500">Sorteio</div>
                    <div className="mt-0.5 font-medium">{formatDateTime(currentEdition.scheduledAt)}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="text-xs text-zinc-500">Preço da cartela</div>
                    <div className="mt-0.5 font-medium">{formatBRLFromCents(Number(currentEdition.cardPriceCents) || 0)}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="text-xs text-zinc-500">Rodadas</div>
                    <div className="mt-0.5 font-medium">{Number(currentEdition.roundsCount) || "—"}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link
                    href={`/admin/edicoes/${currentEdition.id}`}
                    className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
                  >
                    Abrir edição
                  </Link>
                  <Link
                    href="/admin/sorteio"
                    className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
                  >
                    Ir para sorteio
                  </Link>
                </div>

                <div className="rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                  <div className="text-xs font-semibold text-zinc-600">Próximos passos</div>
                  <div className="mt-2 flex flex-col gap-2">
                    {nextSteps.map((s) =>
                      s.href === "#" ? (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => {
                            setErr(null);
                            setCreateStep(1);
                            setCreateOpen(true);
                          }}
                          className="text-left text-sm font-semibold text-zinc-900 hover:underline"
                        >
                          {s.label}
                        </button>
                      ) : (
                        <Link key={s.label} href={s.href} className="text-sm font-semibold text-zinc-900 hover:underline">
                          {s.label}
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-zinc-600">
                Nenhuma edição ativa encontrada. Crie uma nova edição para começar.
              </div>
            )}
          </Card>

          <Card
            title="Como funciona"
            description="Regras para manter tudo organizado e evitar conflitos."
            tone={createBlockedReason ? "warning" : "muted"}
          >
            <ul className="space-y-2 text-sm text-zinc-700">
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                Só pode existir <span className="font-semibold">1 edição ativa</span> por vez.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                Para criar outra, a edição atual precisa estar <span className="font-semibold">Finalizada</span>.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                O histórico fica em <span className="font-semibold">Ver histórico</span>, com pesquisa e filtros.
              </li>
            </ul>

            {createBlockedReason ? (
              <div className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/20">
                {createBlockedReason}
              </div>
            ) : null}
          </Card>

          <Card title="Atalhos" description="Ações rápidas para o dia a dia." tone="muted">
            <div className="grid grid-cols-1 gap-2">
              <Link
                href="/admin/cartelas"
                className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
              >
                Gerenciar cartelas
              </Link>
              <Link
                href="/admin/usuarios"
                className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
              >
                Usuários
              </Link>
            </div>
          </Card>
        </div>

        <Modal
          open={createOpen}
          title="Nova edição"
          onClose={() => {
            if (busy) return;
            setCreateOpen(false);
            resetCreateForm();
          }}
        >
          {/* Stepper */}
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-600">
              <span className={createStep === 1 ? "text-zinc-900" : ""}>1. Configuração</span>
              <span className={createStep === 2 ? "text-zinc-900" : ""}>2. Premiações</span>
              <span className={createStep === 3 ? "text-zinc-900" : ""}>3. Revisão</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{ width: createStep === 1 ? "33%" : createStep === 2 ? "66%" : "100%" }}
              />
            </div>
          </div>

          {createBlockedReason ? (
            <div className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/20">
              {createBlockedReason}
            </div>
          ) : null}

          {err ? (
            <div className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-800 ring-1 ring-red-500/20">{err}</div>
          ) : null}

          {/* Conteúdo por etapa */}
          {createStep === 1 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold text-zinc-800">Nome da edição</label>
                <input
                  ref={firstFieldRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Edição Fevereiro/2026"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
                />
                <p className="mt-1 text-xs text-zinc-500">Esse nome aparece para o time e no painel de controle.</p>
              </div>

              <div>
                <label className="text-sm font-semibold text-zinc-800">Preço da cartela</label>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 focus-within:border-zinc-400">
                  <span className="text-sm font-semibold text-zinc-500">R$</span>
                  <input
                    value={cardPrice}
                    onChange={(e) => setCardPrice(e.target.value)}
                    onBlur={() => setCardPrice((v) => normalizeMoneyInput(v))}
                    placeholder="10,00"
                    inputMode="decimal"
                    className="w-full bg-transparent text-sm outline-none"
                  />
                </div>
                {!basicValid && cardPrice.trim() ? <p className="mt-1 text-xs text-red-600">Informe um valor maior que zero.</p> : null}
              </div>

              <div>
                <label className="text-sm font-semibold text-zinc-800">Data/hora do sorteio</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
                />
                <p className="mt-1 text-xs text-zinc-500">Opcional (você pode definir depois).</p>
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-semibold text-zinc-800">URL do YouTube</label>
                <input
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/..."
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
                />
                <p className="mt-1 text-xs text-zinc-500">Opcional (se você usa live/stream).</p>
              </div>
            </div>
          ) : null}

          {createStep === 2 ? (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-800">Rodadas e prêmios</div>
                  <div className="mt-1 text-xs text-zinc-500">Defina o prêmio de cada rodada (pode ser 0,00). Mínimo: 1 rodada.</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRoundsCount(prizes.length - 1)}
                    className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={prizes.length <= 1}
                  >
                    −
                  </button>
                  <div className="min-w-[3rem] text-center text-sm font-semibold tabular-nums">{prizes.length}</div>
                  <button
                    type="button"
                    onClick={() => setRoundsCount(prizes.length + 1)}
                    className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {prizes.map((v, idx) => (
                  <div key={idx} className="rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-zinc-600">Rodada {idx + 1}</div>
                      <div className="text-xs text-zinc-500">Prêmio</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 focus-within:border-zinc-400">
                      <span className="text-sm font-semibold text-zinc-500">R$</span>
                      <input
                        value={v}
                        onChange={(e) =>
                          setPrizes((prev) => {
                            const out = [...prev];
                            out[idx] = e.target.value;
                            return out;
                          })
                        }
                        onBlur={() =>
                          setPrizes((prev) => {
                            const out = [...prev];
                            out[idx] = normalizeMoneyInput(out[idx] ?? "");
                            return out;
                          })
                        }
                        placeholder="0,00"
                        inputMode="decimal"
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                    {!((v ?? "").trim().length > 0) ? <p className="mt-1 text-xs text-red-600">Informe um valor (use 0,00 se não houver prêmio).</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {createStep === 3 ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-sm font-semibold text-zinc-900">Resumo</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-zinc-500">Edição</div>
                    <div className="mt-0.5 text-sm font-semibold text-zinc-900">{name.trim() || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Preço da cartela</div>
                    <div className="mt-0.5 text-sm font-semibold text-zinc-900">
                      {formatBRLFromCents(parseBRLCents(cardPrice) ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Sorteio</div>
                    <div className="mt-0.5 text-sm font-semibold text-zinc-900">{scheduledAt ? new Date(scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Rodadas</div>
                    <div className="mt-0.5 text-sm font-semibold text-zinc-900">{prizes.length}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-semibold text-zinc-600">Premiações</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {prizes.map((p, i) => (
                      <div key={i} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-zinc-200">
                        <span className="text-xs text-zinc-500">Rodada {i + 1}</span>
                        <div className="font-semibold text-zinc-900">{formatBRLFromCents(parseBRLCents(p) ?? 0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                <div className="text-sm font-semibold text-zinc-900">O que acontece ao criar?</div>
                <ul className="mt-2 space-y-2 text-sm text-zinc-700">
                  <li className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                    A nova edição vira a <span className="font-semibold">edição ativa</span>.
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                    As rodadas são criadas automaticamente com os prêmios.
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          {/* Rodapé */}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setCreateOpen(false);
                resetCreateForm();
              }}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
              disabled={busy}
            >
              Cancelar
            </button>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {createStep > 1 ? (
                <button
                  type="button"
                  onClick={() => setCreateStep((s) => (s === 3 ? 2 : 1))}
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
                  disabled={busy}
                >
                  Voltar
                </button>
              ) : null}

              {createStep < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    setErr(null);
                    if (createStep === 1) {
                      if (!basicValid) {
                        setErr("Preencha o nome e o preço da cartela para continuar.");
                        return;
                      }
                      setCreateStep(2);
                      return;
                    }
                    if (createStep === 2) {
                      if (!prizesValid) {
                        setErr("Informe o valor de todas as rodadas (use 0,00 se necessário).");
                        return;
                      }
                      setCreateStep(3);
                    }
                  }}
                  className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy || !!createBlockedReason}
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCreate}
                  className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canCreate || busy}
                  title={createBlockedReason ?? ""}
                >
                  {busy ? "Criando..." : "Criar edição"}
                </button>
              )}
            </div>
          </div>
        </Modal>
        </div>
      </div>
    </AdminGuard>
  );
}
