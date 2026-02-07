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
    <AdminGuard>
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Histórico de edições</h1>
            <p className="mt-1 text-sm text-zinc-600">Pesquise por nome/ID e abra uma edição para ver detalhes.</p>
          </div>

          <Link
            href="/admin/edicoes"
            className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
          >
            Voltar
          </Link>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
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

          <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-zinc-200">
            <div className="grid grid-cols-12 gap-0 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-600">
              <div className="col-span-5">Edição</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 hidden sm:block">Cartela</div>
              <div className="col-span-3 hidden md:block">Criada</div>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-sm text-zinc-600">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-sm text-zinc-600">Nenhuma edição encontrada com esses filtros.</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filtered.map((it) => (
                  <Link
                    key={it.id}
                    href={`/admin/edicoes/${it.id}`}
                    className="grid grid-cols-12 items-center gap-0 px-4 py-3 hover:bg-zinc-50"
                  >
                    <div className="col-span-5 min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">{it.name || "Sem nome"}</div>
                      <div className="mt-0.5 truncate text-xs text-zinc-500">ID: {it.id}</div>
                      <div className="mt-1 text-xs text-zinc-500 md:hidden">Criada: {formatDateTime(it.createdAt)}</div>
                    </div>

                    <div className="col-span-2">
                      <StatusPill status={it.status} />
                    </div>

                    <div className="col-span-2 hidden sm:block">
                      <div className="text-sm font-medium text-zinc-900">{formatBRLFromCents(Number(it.cardPriceCents) || 0)}</div>
                      <div className="text-xs text-zinc-500">{Number(it.roundsCount) || 0} rodadas</div>
                    </div>

                    <div className="col-span-3 hidden md:block text-sm text-zinc-700">{formatDateTime(it.createdAt)}</div>
                  </Link>
                ))}
              </div>
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
