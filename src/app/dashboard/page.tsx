"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/src/components/AppShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useDashboardSummary } from "@/src/lib/dashboard/useDashboardSummary";
import { formatBRLFromCents } from "@/src/lib/prosperar/format";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-800 ring-1 ring-zinc-200">
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
      <p className="text-xs text-zinc-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-9000">{hint}</p> : null}
    </div>
  );
}

function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-zinc-9000">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function MiniBars({ values, max }: { values: number[]; max: number }) {
  // Simple bar chart without external deps
  return (
    <div className="mt-3 grid grid-cols-14 items-end gap-1 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
      {values.map((v, i) => {
        const h = max <= 0 ? 2 : Math.max(2, Math.round((v / max) * 40));
        return (
          <div key={i} className="flex flex-col items-center justify-end">
            <div className="w-full rounded-md bg-zinc-900/20" style={{ height: `${h}px` }} />
          </div>
        );
      })}
    </div>
  );
}

function ActionCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="block">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200 hover:ring-zinc-200">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-zinc-600">{desc}</p>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { data, loading, error, reload, editionId, setEditionId } = useDashboardSummary();
  const [editionModalOpen, setEditionModalOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const title = useMemo(() => {
    const r = data?.role;
    if (r === "admin") return "Painel administrativo";
    if (r === "vendor") return "Meu painel";
    return "Dashboard";
  }, [data?.role]);

  if (authLoading || loading) {
    return (
      <AppShell title="Dashboard">
        <p className="text-sm text-zinc-600">Carregando…</p>
      </AppShell>
    );
  }
  if (!user) {
    return (
      <AppShell title="Dashboard">
        <p className="text-sm text-zinc-600">Redirecionando…</p>
      </AppShell>
    );
  }

  const edition = data?.edition ?? null;
  const k = data?.kpis;
  const trend = data?.trend ?? [];
  const salesBars = trend.map((x) => x.sales);
  const cardsBars = trend.map((x) => x.cards);
  const maxSales = Math.max(0, ...salesBars);
  const maxCards = Math.max(0, ...cardsBars);

  const isAdmin = data?.role === "admin";
  const isCurrentEdition = !!(isAdmin && edition?.id && data?.currentEditionId && edition.id === data.currentEditionId);

  const editionsList = data?.editionsList ?? [];

  return (
    <AppShell title={title}>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
        <SectionTitle
          title={isAdmin ? (isCurrentEdition ? "Edição vigente" : "Edição selecionada") : "Edição ativa"}
          subtitle={
            edition
              ? `${edition.name} • status: ${edition.status ?? "—"}${isAdmin ? (isCurrentEdition ? " • vigente" : " • passada") : ""}`
              : "Nenhuma edição ativa"
          }
          right={
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setEditionModalOpen(true)}
                  className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium ring-1 ring-zinc-200 hover:ring-zinc-200"
                >
                  Trocar edição
                </button>
              ) : null}
              <button
                type="button"
                onClick={reload}
                className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium ring-1 ring-zinc-200 hover:ring-zinc-200"
              >
                Atualizar
              </button>
            </div>
          }
          
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {data?.role ? <Pill>Perfil: {isAdmin ? "Admin" : "Vendedor"}</Pill> : null}
          {user.email ? <Pill>{user.email}</Pill> : null}
        </div>
      </div>

      {/* Edition selector modal (admin) */}
      {isAdmin && editionModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3"
          onClick={() => setEditionModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-4 ring-1 ring-zinc-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Selecionar edição</p>
                <p className="mt-0.5 text-xs text-zinc-9000">A edição selecionada muda todos os números do dashboard.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditionModalOpen(false)}
                className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium ring-1 ring-zinc-200"
              >
                Fechar
              </button>
            </div>

            <div className="mt-3 max-h-[60dvh] overflow-auto rounded-2xl bg-zinc-50 p-2 ring-1 ring-zinc-200">
              {editionsList.length ? (
                <div className="space-y-2">
                  {editionsList.map((e) => {
                    const selected = (editionId || data?.currentEditionId) === e.id;
                    const current = data?.currentEditionId === e.id;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          setEditionId(e.id);
                          setEditionModalOpen(false);
                        }}
                        className={
                          "w-full rounded-2xl px-3 py-3 text-left ring-1 " +
                          (selected ? "bg-zinc-100 ring-zinc-200" : "bg-white ring-zinc-200 hover:ring-zinc-200")
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{e.name}</p>
                            <p className="mt-0.5 text-xs text-zinc-9000">Status: {e.status || "—"}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            {current ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 ring-1 ring-emerald-500/30">
                                vigente
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-zinc-900/50 px-2 py-1 text-xs text-zinc-700 ring-1 ring-zinc-200">
                                passada
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="p-3 text-sm text-zinc-600">Nenhuma edição encontrada.</p>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <Link href="/admin/edicoes" className="text-xs text-zinc-700 underline">
                Gerenciar edições
              </Link>
              <button
                type="button"
                onClick={() => {
                  setEditionId(data?.currentEditionId ?? null);
                  setEditionModalOpen(false);
                }}
                className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium ring-1 ring-zinc-200"
              >
                Ir para vigente
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">
          {error}
        </div>
      ) : null}

      {isAdmin ? (
        <>
          {/* KPIs principais */}
          <div className="mt-4">
            <SectionTitle
              title="Visão geral"
              subtitle={isCurrentEdition ? "Acompanhe vendas e arrecadação da edição vigente" : "Resumo da edição selecionada"}
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Cartelas vendidas" value={k?.cardsValidated ?? 0} hint="Cartelas validadas" />
              <StatCard
                label="Valor arrecadado"
                value={formatBRLFromCents(k?.revenueCents ?? 0)}
                hint={k?.cardPriceCents ? `Preço: ${formatBRLFromCents(k.cardPriceCents)} / cartela` : "Preço não definido"}
              />
              <StatCard label="Vendas" value={k?.salesCount ?? 0} hint="Registros em sales" />
              <StatCard label="Cartelas disponíveis" value={k?.cardsAvailable ?? 0} hint="Ainda não vendidas" />
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Últimos 14 dias</h3>
                <p className="text-xs text-zinc-9000">Vendas e cartelas validadas por dia</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-200/30" /> vendas
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-900/15" /> cartelas
                </span>
              </div>
            </div>

            <MiniBars values={salesBars} max={maxSales} />
            <MiniBars values={cardsBars} max={maxCards} />

            <div className="mt-3 flex items-center justify-between text-xs text-zinc-9000">
              <span>{trend[0]?.date ?? "—"}</span>
              <span>{trend[trend.length - 1]?.date ?? "—"}</span>
            </div>
          </div>

          {/* Detalhes administrativos */}
          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <SectionTitle title="Operação" subtitle="Rodadas e andamento do sorteio" right={<Link href={edition ? `/admin/edicoes/${edition.id}` : "/admin/edicoes"} className="text-xs text-zinc-700 underline">Abrir edição</Link>} />

            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Rodadas" value={edition?.roundsCount ?? "—"} />
              <StatCard label="Prêmios (total)" value={formatBRLFromCents(data?.editionDetails?.totalPrizeCents ?? 0)} hint="Soma dos prêmios das rodadas" />
            </div>

            {data?.editionDetails?.roundsStatusCount ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-zinc-50 p-3 text-center ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-9000">READY</p>
                  <p className="mt-1 text-sm font-semibold">{data.editionDetails.roundsStatusCount.READY ?? 0}</p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3 text-center ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-9000">RUNNING</p>
                  <p className="mt-1 text-sm font-semibold">{data.editionDetails.roundsStatusCount.RUNNING ?? 0}</p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3 text-center ring-1 ring-zinc-200">
                  <p className="text-xs text-zinc-9000">CLOSED</p>
                  <p className="mt-1 text-sm font-semibold">{data.editionDetails.roundsStatusCount.CLOSED ?? 0}</p>
                </div>
              </div>
            ) : null}

            {data?.editionDetails?.runningRound ? (
              <div className="mt-3 rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                <p className="text-sm font-semibold">Rodada em andamento</p>
                <p className="mt-1 text-xs text-zinc-600">
                  Rodada #{data.editionDetails.runningRound.index ?? "—"} • números sorteados: {data.editionDetails.runningRound.drawnNumbersCount}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-9000">Nenhuma rodada em andamento agora.</p>
            )}
          </div>

          {/* Vendedores */}
          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <SectionTitle title="Vendedores" subtitle="Quem mais está vendendo nesta edição" right={<Link href="/admin/vendedores" className="text-xs text-zinc-700 underline">Ver todos</Link>} />

            {data.topVendors?.length ? (
              <div className="mt-3 space-y-2">
                {data.topVendors.map((v) => (
                  <div key={v.vendorUid} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{v.vendorEmail || v.vendorUid}</p>
                      <p className="text-xs text-zinc-9000">{v.salesCount} vendas</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{v.cardsSold}</p>
                      <p className="text-xs text-zinc-9000">cartelas</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-600">Sem dados suficientes ainda.</p>
            )}
          </div>

          {/* Histórico agora fica no seletor de edição (modal) */}
        </>
      ) : (
        <>
          {/* Vendedor */}
          <div className="mt-4">
            <SectionTitle title="Resumo" subtitle="Seu desempenho na edição atual" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Cartelas geradas" value={k?.cardsTotal ?? 0} hint="Total da edição ativa" />
              <StatCard label="Cartelas validadas" value={k?.cardsValidated ?? 0} hint="Contam para o sorteio" />
              <StatCard label="Minhas vendas" value={k?.mySalesCount ?? 0} />
              <StatCard label="Minhas cartelas" value={k?.myCardsSold ?? 0} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <SectionTitle title="Últimos 14 dias" subtitle="Vendas e cartelas validadas por dia" />
            <MiniBars values={salesBars} max={maxSales} />
            <MiniBars values={cardsBars} max={maxCards} />
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-9000">
              <span>{trend[0]?.date ?? "—"}</span>
              <span>{trend[trend.length - 1]?.date ?? "—"}</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <SectionTitle title="Ações" subtitle="Atalhos do dia a dia" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <ActionCard title="Validar cartela" desc="Cadastrar cartelas vendidas" href="/vendedor/validar" />
              <ActionCard title="Consulta pública" desc="Consultar cartelas por CPF+telefone" href="/resultado" />
            </div>
            <p className="mt-3 text-xs text-zinc-9000">Dica: valide as cartelas somente após confirmar os dados do comprador.</p>
          </div>
        </>
      )}
    </AppShell>
  );
}
