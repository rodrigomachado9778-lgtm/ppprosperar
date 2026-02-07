"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";
import type { EditionStatus } from "@/src/lib/prosperar/types";
import { formatBRLFromCents } from "@/src/lib/prosperar/format";

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

export default function AdminEditionsHistoryPage() {
  const [items, setItems] = useState<EditionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | EditionStatus>("ALL");

  async function load() {
    setLoading(true);
    const q = query(collection(db, "editions"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const rows: EditionRow[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));
    setItems(rows);
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter !== "ALL" && it.status !== statusFilter) return false;
      if (!t) return true;
      return it.name?.toLowerCase().includes(t) || it.id.toLowerCase().includes(t);
    });
  }, [items, qText, statusFilter]);

  return (
    <AdminGuard
      title="Histórico de edições"
      subtitle="Pesquise por nome/ID e abra uma edição para ver detalhes."
    >
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-white">
        {/* desktop igual mobile */}
        <div className="mx-auto w-full max-w-[640px] px-4 py-6">
          <Link
            href="/admin/edicoes"
            className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
          >
            Voltar
          </Link>

          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-sm font-semibold text-zinc-800">Pesquisar</label>
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Digite nome ou ID..."
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-zinc-800">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="ALL">Todos</option>
                  <option value="DRAFT">Rascunho</option>
                  <option value="READY">Pronta</option>
                  <option value="RUNNING">Em andamento</option>
                  <option value="FINISHED">Finalizada</option>
                </select>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 ring-1 ring-zinc-200">
                  Carregando...
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 ring-1 ring-zinc-200">
                  Nenhuma edição encontrada com esses filtros.
                </div>
              ) : (
                filtered.map((it) => (
                  <Link
                    key={it.id}
                    href={`/admin/edicoes/${it.id}`}
                    className="block rounded-2xl bg-white p-4 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900">{it.name || "Sem nome"}</div>
                        <div className="mt-0.5 truncate text-xs text-zinc-500">ID: {it.id}</div>
                      </div>
                      <StatusPill status={it.status} />
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-zinc-700">
                      <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                        <div className="text-xs text-zinc-500">Criada em</div>
                        <div className="mt-0.5 font-medium">{formatDateTime(it.createdAt)}</div>
                      </div>

                      <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                        <div className="text-xs text-zinc-500">Cartela</div>
                        <div className="mt-0.5 font-medium">{formatBRLFromCents(Number(it.cardPriceCents) || 0)}</div>
                        <div className="mt-1 text-xs text-zinc-500">{Number(it.roundsCount) || 0} rodadas</div>
                      </div>

                      <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                        <div className="text-xs text-zinc-500">Sorteio</div>
                        <div className="mt-0.5 font-medium">{formatDateTime(it.scheduledAt)}</div>
                      </div>
                    </div>

                    <div className="mt-3 text-xs font-semibold text-zinc-900">Abrir detalhes →</div>
                  </Link>
                ))
              )}
            </div>

            <div className="mt-3 text-xs text-zinc-500">
              Dica: clique em uma edição para abrir os detalhes.
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
