"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";

type VendorRow = {
  id: string;
  email: string | null;
  displayName?: string | null;
  role: "vendor";
  activeEditionId: string | null;
};

type SystemConfig = {
  currentEditionId?: string | null;
  currentEditionStatus?: string | null;
};

type EditionLite = {
  id: string;
  name: string;
  status: string;
  nextBatch?: number;
};

function toPositiveInt(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

function uniqueSorted(nums: number[]) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

async function getIdTokenOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("not_signed_in");
  return u.getIdToken();
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
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
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[640px] rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200">
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

export default function AdminVendedoresPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [system, setSystem] = useState<SystemConfig | null>(null);
  const [currentEdition, setCurrentEdition] = useState<EditionLite | null>(null);

  // batches por vendedor (somente da edição atual)
  const [batchesByVendor, setBatchesByVendor] = useState<Record<string, number[]>>({});
  const [batchInput, setBatchInput] = useState<string>("");

  // mensagens
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // modal criar
  const [createOpen, setCreateOpen] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [createdTemp, setCreatedTemp] = useState<{ email: string; uid: string; tempPassword: string } | null>(null);

  // modal vendedor
  const [vendorOpen, setVendorOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  const selectedVendor = useMemo(() => {
    if (!selectedVendorId) return null;
    return vendors.find((v) => v.id === selectedVendorId) ?? null;
  }, [vendors, selectedVendorId]);

  const editionId = system?.currentEditionId ?? null;

  async function load() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    // sistema (edição atual)
    const sysSnap = await getDoc(doc(db, "config", "system"));
    const sys = sysSnap.exists() ? (sysSnap.data() as any as SystemConfig) : null;
    setSystem(sys);

    // edição atual (somente para exibir info e range de lotes)
    if (sys?.currentEditionId) {
      const edSnap = await getDoc(doc(db, "editions", sys.currentEditionId));
      if (edSnap.exists()) {
        const d = edSnap.data() as any;
        setCurrentEdition({
          id: edSnap.id,
          name: String(d?.name ?? edSnap.id),
          status: String(d?.status ?? "READY"),
          nextBatch: typeof d?.nextBatch === "number" ? d.nextBatch : undefined,
        });
      } else {
        setCurrentEdition(null);
      }
    } else {
      setCurrentEdition(null);
    }

    // vendedores
    const qUsers = query(collection(db, "users"), where("role", "==", "vendor"));
    const uSnap = await getDocs(qUsers);
    const rows: VendorRow[] = uSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        email: (data.email ?? null) as string | null,
        displayName: (data.displayName ?? null) as string | null,
        role: "vendor",
        activeEditionId: (data.activeEditionId ?? null) as string | null,
      };
    });
    setVendors(rows);

    // permissões de lote (apenas edição atual)
    if (sys?.currentEditionId) {
      const entries: Array<[string, number[]]> = [];
      for (const v of rows) {
        try {
          const pSnap = await getDoc(doc(db, "editions", sys.currentEditionId, "vendor_permissions", v.id));
          const raw = (pSnap.exists() ? ((pSnap.data() as any).batches ?? []) : []) as any[];
          const clean = uniqueSorted(
            raw
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n) && n > 0)
              .map((n) => Math.floor(n)),
          );
          entries.push([v.id, clean]);
        } catch {
          entries.push([v.id, []]);
        }
      }
      setBatchesByVendor(Object.fromEntries(entries));
    } else {
      setBatchesByVendor({});
    }

    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => {
      setLoading(false);
      setErr("Não foi possível carregar vendedores. Verifique permissões e conexão.");
    });
  }, []);

  // foco quando abre modal criar
  useEffect(() => {
    if (!createOpen) return;
    const t = window.setTimeout(() => emailRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [createOpen]);

  function openVendor(vendorId: string) {
    setErr(null);
    setMsg(null);
    setBatchInput("");
    setSelectedVendorId(vendorId);
    setVendorOpen(true);
  }

  async function createVendor() {
    setErr(null);
    setMsg(null);
    setCreatedTemp(null);
    setBusyId("create");
    try {
      const idToken = await getIdTokenOrThrow();
      const r = await fetch("/api/admin/vendors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          email: newEmail,
          name: newName || null,
          activeEditionId: editionId, // sem tela de edições: usa a edição atual do sistema
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao criar vendedor.");

      setCreatedTemp({ email: String(j.email), uid: String(j.uid), tempPassword: String(j.tempPassword) });
      setNewEmail("");
      setNewName("");
      setMsg(
        "Vendedor criado. Anote a senha temporária (será exibida uma vez).\nDepois, o vendedor pode redefinir a senha na tela de login.",
      );
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "Falha ao criar vendedor."));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteVendor(uid: string) {
    setErr(null);
    setMsg(null);
    setBusyId(uid);
    try {
      const idToken = await getIdTokenOrThrow();
      const r = await fetch(`/api/admin/vendors/${uid}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${idToken}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao excluir vendedor.");

      setMsg("Vendedor excluído.");
      setVendorOpen(false);
      setSelectedVendorId(null);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "Falha ao excluir vendedor."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveBatches(vendorId: string, batches: number[]) {
    if (!editionId) throw new Error("no_current_edition");
    const clean = uniqueSorted(
      batches
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.floor(n)),
    );

    const idToken = await getIdTokenOrThrow();
    const r = await fetch(`/api/admin/vendors/${vendorId}/batches`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ editionId, batches: clean }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao salvar lotes.");

    const nextBatches = Array.isArray(j?.batches) ? (j.batches as number[]) : clean;
    setBatchesByVendor((prev) => ({ ...prev, [vendorId]: uniqueSorted(nextBatches) }));
    return j as any;
  }

  const totals = useMemo(() => {
    return {
      total: vendors.length,
      withBatches: vendors.filter((v) => (batchesByVendor[v.id] ?? []).length > 0).length,
    };
  }, [vendors, batchesByVendor]);

  const canAssign = Boolean(editionId);
  const maxExistingBatch = typeof currentEdition?.nextBatch === "number" ? Math.max(0, (currentEdition?.nextBatch ?? 1) - 1) : null;

  return (
    <AdminGuard title="Vendedores" subtitle="Cadastre vendedores e atribua lotes de cartelas pela edição atual">
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-white">
        {/* mobile-like em qualquer tela */}
        <div className="mx-auto w-full max-w-[640px] px-4 py-6">
          {/* ações */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setMsg(null);
                setCreatedTemp(null);
                setCreateOpen(true);
              }}
              className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Cadastrar vendedor
            </button>

            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
              >
                Voltar
              </Link>
              <button
                type="button"
                onClick={() => load().catch(() => setErr("Não foi possível recarregar."))}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
              >
                Recarregar
              </button>
            </div>
          </div>

          {/* estado edição atual */}
          <div className="mt-4">
            <Card
              title="Edição atual"
              description="Os lotes atribuídos ao vendedor valem para a edição ativa do sistema."
            >
              {editionId ? (
                <div className="space-y-2">
                  <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <div className="text-xs text-zinc-500">Edição</div>
                    <div className="mt-0.5 text-sm font-semibold text-zinc-900">{currentEdition?.name ?? editionId}</div>
                    <div className="mt-1 text-xs text-zinc-500">Status: {currentEdition?.status ?? (system?.currentEditionStatus ?? "—")}</div>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {maxExistingBatch ? `Lotes existentes: 1..${maxExistingBatch}` : "Dica: gere cartelas para criar novos lotes."}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/20">
                  Nenhuma edição ativa encontrada. Crie/ative uma edição para poder atribuir lotes aos vendedores.
                </div>
              )}
            </Card>
          </div>

          {/* mensagens */}
          {msg ? (
            <div className="mt-4 whitespace-pre-line rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-900 ring-1 ring-emerald-500/20">{msg}</div>
          ) : null}
          {err ? (
            <div className="mt-4 whitespace-pre-line rounded-xl bg-red-500/10 p-3 text-sm text-red-800 ring-1 ring-red-500/20">{err}</div>
          ) : null}

          {/* resumo */}
          <div className="mt-4">
            <Card title="Resumo" description="Controle rápido do time de vendas">
              <div className="overflow-x-auto">
                <div className="grid min-w-[520px] grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                    <div className="text-xs font-semibold text-zinc-500">Vendedores</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{loading ? "—" : totals.total}</div>
                    <div className="mt-1 text-xs text-zinc-500">Cadastrados</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                    <div className="text-xs font-semibold text-zinc-500">Com lotes</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{loading ? "—" : totals.withBatches}</div>
                    <div className="mt-1 text-xs text-zinc-500">Liberados para vender</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* lista */}
          <div className="mt-4">
            <Card title="Vendedores" description="Clique em um vendedor para atribuir lote ou excluir.">
              {loading ? (
                <div className="text-sm text-zinc-600">Carregando...</div>
              ) : vendors.length === 0 ? (
                <div className="text-sm text-zinc-600">Nenhum vendedor cadastrado.</div>
              ) : (
                <div className="space-y-3">
                  {vendors.map((v) => {
                    const batches = batchesByVendor[v.id] ?? [];
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => openVendor(v.id)}
                        className="w-full rounded-2xl bg-white p-4 text-left ring-1 ring-zinc-200 transition hover:bg-zinc-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900">{v.displayName || v.email || v.id}</div>
                            <div className="mt-1 truncate text-xs text-zinc-500">{v.email ? v.email : `UID: ${v.id}`}</div>
                          </div>
                          <div className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                            {batches.length ? `${batches.length} lote(s)` : "Sem lotes"}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {batches.length ? (
                            batches.slice(0, 6).map((b) => (
                              <span key={b} className="rounded-full bg-zinc-900/10 px-3 py-1 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200">
                                Lote {b}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-zinc-500">Clique para atribuir o primeiro lote.</span>
                          )}
                          {batches.length > 6 ? (
                            <span className="text-xs font-semibold text-zinc-700">+{batches.length - 6}…</span>
                          ) : null}
                        </div>

                        <div className="mt-3 text-xs font-semibold text-zinc-900">Gerenciar →</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* MODAL: cadastrar */}
      <Modal
        open={createOpen}
        title="Cadastrar vendedor"
        onClose={() => {
          if (busyId === "create") return;
          setCreateOpen(false);
          setCreatedTemp(null);
          setNewEmail("");
          setNewName("");
        }}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-800">E-mail do vendedor</label>
            <input
              ref={emailRef}
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="vendedor@exemplo.com"
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-zinc-800">Nome (opcional)</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do vendedor"
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
            />
          </div>

          <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600 ring-1 ring-zinc-200">
            A conta será criada no Auth e o perfil será salvo em <span className="font-semibold">/users</span> com role vendor.
            {editionId ? (
              <div className="mt-1">
                Este vendedor já ficará vinculado à edição atual: <span className="font-semibold">{currentEdition?.name ?? editionId}</span>.
              </div>
            ) : (
              <div className="mt-1 text-amber-900">
                Atenção: não existe edição ativa agora. Você ainda poderá atribuir lotes quando houver uma edição atual.
              </div>
            )}
          </div>

          {createdTemp ? (
            <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-900 ring-1 ring-amber-500/20">
              <p className="font-semibold">Senha temporária (anote agora)</p>
              <p className="mt-1">
                <span className="text-zinc-700">E-mail:</span> {createdTemp.email}
              </p>
              <p>
                <span className="text-zinc-700">UID:</span> {createdTemp.uid}
              </p>
              <p className="mt-2 break-all">
                <span className="text-zinc-700">Senha:</span> {createdTemp.tempPassword}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={createVendor}
            disabled={!newEmail.trim() || busyId === "create"}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyId === "create" ? "Criando..." : "Criar vendedor"}
          </button>
        </div>
      </Modal>

      {/* MODAL: vendedor */}
      <Modal
        open={vendorOpen}
        title={selectedVendor ? `Vendedor: ${selectedVendor.displayName || selectedVendor.email || selectedVendor.id}` : "Vendedor"}
        onClose={() => {
          if (busyId) return;
          setVendorOpen(false);
          setSelectedVendorId(null);
          setBatchInput("");
        }}
      >
        {!selectedVendor ? (
          <div className="text-sm text-zinc-600">Selecione um vendedor.</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs text-zinc-500">E-mail</div>
              <div className="mt-0.5 text-sm font-semibold text-zinc-900">{selectedVendor.email ?? "—"}</div>
              <div className="mt-2 text-xs text-zinc-500">UID</div>
              <div className="mt-0.5 break-all text-xs font-semibold text-zinc-800">{selectedVendor.id}</div>
            </div>

            <Card
              title="Atribuir lote"
              description={
                canAssign
                  ? `Atribuição vale para a edição atual: ${currentEdition?.name ?? editionId}.`
                  : "Crie/ative uma edição para liberar lotes."
              }
            >
              {!canAssign ? (
                <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/20">
                  Sem edição ativa. Não é possível atribuir lotes agora.
                </div>
              ) : (
                <>
                  <div className="text-xs text-zinc-600">Lotes liberados{maxExistingBatch ? ` (existem: 1..${maxExistingBatch})` : ""}:</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(batchesByVendor[selectedVendor.id] ?? []).length ? (
                      (batchesByVendor[selectedVendor.id] ?? []).map((b) => (
                        <button
                          key={b}
                          type="button"
                          title="Remover lote"
                          disabled={busyId === selectedVendor.id}
                          onClick={async () => {
                            setErr(null);
                            setMsg(null);
                            setBusyId(selectedVendor.id);
                            try {
                              const current = batchesByVendor[selectedVendor.id] ?? [];
                              await saveBatches(selectedVendor.id, current.filter((x) => x !== b));
                              setMsg("Lote removido do vendedor.");
                            } catch {
                              setErr("Não foi possível salvar lotes. Verifique permissões.");
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className="rounded-full bg-zinc-900/10 px-3 py-1 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-900/15 disabled:opacity-50"
                        >
                          Lote {b} ✕
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-zinc-500">Nenhum lote liberado ainda.</span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        placeholder="Ex: 3"
                        inputMode="numeric"
                        disabled={busyId === selectedVendor.id}
                        className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        disabled={busyId === selectedVendor.id}
                        onClick={async () => {
                          setErr(null);
                          setMsg(null);
                          const n = toPositiveInt(batchInput.trim());
                          if (!n) {
                            setErr("Informe um número de lote válido.");
                            return;
                          }
                          setBusyId(selectedVendor.id);
                          try {
                            const current = batchesByVendor[selectedVendor.id] ?? [];
                            await saveBatches(selectedVendor.id, [...current, n]);
                            setBatchInput("");
                            setMsg("Lote liberado para o vendedor.");
                          } catch {
                            setErr("Não foi possível salvar lotes. Verifique permissões.");
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Adicionar
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={busyId === selectedVendor.id}
                      onClick={async () => {
                        if (!confirm("Remover TODOS os lotes deste vendedor?") ) return;
                        setErr(null);
                        setMsg(null);
                        setBusyId(selectedVendor.id);
                        try {
                          await saveBatches(selectedVendor.id, []);
                          setMsg("Lotes removidos do vendedor.");
                        } catch {
                          setErr("Não foi possível remover lotes. Verifique permissões.");
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-60"
                    >
                      Limpar lotes
                    </button>
                  </div>

                  <div className="mt-2 text-xs text-zinc-500">
                    Dica: o vendedor só consegue validar/vender cartelas dos lotes liberados.
                  </div>
                </>
              )}
            </Card>

            <Card title="Zona de risco" description="A exclusão remove o usuário do Auth e apaga o perfil.">
              <button
                type="button"
                disabled={busyId === selectedVendor.id}
                onClick={() => {
                  if (!confirm("Excluir este vendedor? Isso remove o usuário do Auth e apaga o perfil.")) return;
                  deleteVendor(selectedVendor.id);
                }}
                className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === selectedVendor.id ? "Excluindo..." : "Excluir vendedor"}
              </button>
            </Card>
          </div>
        )}
      </Modal>
    </AdminGuard>
  );
}
