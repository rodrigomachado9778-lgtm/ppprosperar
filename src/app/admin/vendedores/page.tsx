"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  startAfter,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";

type UserRow = {
  id: string;
  email: string | null;
  role: "admin" | "vendor";
  activeEditionId: string | null;
  displayName?: string | null;
};

type EditionRow = {
  id: string;
  name: string;
  status: string;
  nextBatch?: number;
};

function permKey(editionId: string, userId: string) {
  return `${editionId}:${userId}`;
}

async function getIdTokenOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("not_signed_in");
  return u.getIdToken();
}


async function markBatchAvailable(editionId: string, batchNumber: number) {
  // Quando o admin libera um lote para um vendedor, todas as cartelas daquele lote
  // passam de GENERATED -> AVAILABLE.
  // Fazemos paginação defensiva (caso exista mais de 100 cartelas no lote).
  let updatedTotal = 0;
  let lastDoc: any = null;

  while (true) {
    const q = lastDoc
      ? query(
          collection(db, "editions", editionId, "cards"),
          where("batch", "==", batchNumber),
          where("status", "==", "GENERATED"),
          orderBy("__name__"),
          startAfter(lastDoc),
          limit(200),
        )
      : query(
          collection(db, "editions", editionId, "cards"),
          where("batch", "==", batchNumber),
          where("status", "==", "GENERATED"),
          orderBy("__name__"),
          limit(200),
        );

    const snap = await getDocs(q);
    if (snap.empty) break;

    const b = writeBatch(db);
    for (const d of snap.docs) {
      b.update(d.ref, { status: "AVAILABLE", availableAt: serverTimestamp() });
    }
    await b.commit();

    updatedTotal += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];

    // Se vier menos que o limite, já terminou.
    if (snap.size < 200) break;
  }

  return { updated: updatedTotal };
}


export default function AdminVendedoresPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [perms, setPerms] = useState<Record<string, number[]>>({});
  const [batchInputs, setBatchInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [createdTemp, setCreatedTemp] = useState<{ email: string; uid: string; tempPassword: string } | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setMsg(null);

    // vendedores
    const qUsers = query(collection(db, "users"), where("role", "==", "vendor"));
    const uSnap = await getDocs(qUsers);
    const vendors: UserRow[] = uSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        email: (data.email ?? null) as string | null,
        role: "vendor",
        activeEditionId: (data.activeEditionId ?? null) as string | null,
        displayName: (data.displayName ?? null) as string | null,
      };
    });
    setUsers(vendors);

    // edições
    const eSnap = await getDocs(collection(db, "editions"));
    const eds: EditionRow[] = eSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        status: String(data.status ?? "READY"),
        nextBatch: typeof data.nextBatch === "number" ? data.nextBatch : undefined,
      };
    });
    setEditions(eds);

    // permissões de lotes por vendedor (apenas para a edição ativa)
    const permEntries: Array<[string, number[]]> = [];
    for (const u of vendors) {
      if (!u.activeEditionId) continue;
      const k = permKey(u.activeEditionId, u.id);
      try {
        const pSnap = await getDoc(doc(db, "editions", u.activeEditionId, "vendor_permissions", u.id));
        const arr = (pSnap.exists() ? ((pSnap.data() as any).batches ?? []) : []) as any[];
        const batches = Array.from(
          new Set(
            arr
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x) && x > 0)
              .sort((a, b) => a - b),
          ),
        );
        permEntries.push([k, batches]);
      } catch {
        permEntries.push([k, []]);
      }
    }
    setPerms((prev) => ({ ...prev, ...Object.fromEntries(permEntries) }));
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
        body: JSON.stringify({ email: newEmail, name: newName || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao criar vendedor.");
      setCreatedTemp({ email: String(j.email), uid: String(j.uid), tempPassword: String(j.tempPassword) });
      setNewEmail("");
      setNewName("");
      setMsg("Vendedor criado. Anote a senha temporária (será exibida uma vez).\nDepois, o vendedor pode redefinir a senha na tela de login.");
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
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "Falha ao excluir vendedor."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveBatches(userId: string, editionId: string, batches: number[]) {
    const clean = Array.from(new Set(batches.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))).sort(
      (a, b) => a - b,
    );

    const idToken = await getIdTokenOrThrow();
    const r = await fetch(`/api/admin/vendors/${userId}/batches`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ editionId, batches: clean }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao salvar lotes.");

    const key = permKey(editionId, userId);
    const nextBatches = Array.isArray(j?.batches) ? j.batches : clean;
    setPerms((prev) => ({ ...prev, [key]: nextBatches }));
  }

  async function tryFixByName(userId: string, value: string) {
    setErr(null);
    setMsg(null);
    setBusyId(userId);
    try {
      const qByName = query(collection(db, "editions"), where("name", "==", value), limit(2));
      const s = await getDocs(qByName);
      if (s.size !== 1) {
        setErr("Não foi possível corrigir automaticamente: nenhuma (ou mais de uma) edição com esse nome.");
        return;
      }
      await setActiveEdition(userId, s.docs[0].id);
      setMsg("Corrigido: edição vigente agora aponta para o ID correto.");
    } catch {
      setErr("Falha ao tentar corrigir automaticamente.");
    } finally {
      setBusyId(null);
    }
  }

  async function setActiveEdition(userId: string, editionId: string | null) {
    setErr(null);
    setMsg(null);
    setBusyId(userId);
    try {
      const idToken = await getIdTokenOrThrow();
      const r = await fetch(`/api/admin/vendors/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ activeEditionId: editionId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.message || "Falha ao atualizar.");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, activeEditionId: editionId } : u)));
      setMsg("Edição vigente atualizada.");
    } catch {
      setErr("Não foi possível atualizar. Verifique as regras do Firestore (admin update em /users).\nE confirme se o token do admin tem claim role=admin.");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    load().catch(() => setErr("Não foi possível carregar vendedores/edições. Verifique permissões."));
  }, []);

  const editionMap = useMemo(() => {
    const m = new Map<string, EditionRow>();
    for (const e of editions) m.set(e.id, e);
    return m;
  }, [editions]);

  return (
    <AdminGuard title="Vendedores" subtitle="Somente o admin pode cadastrar, excluir ou alterar vendedores">
      <div className="space-y-6">
        <div className="rounded-2xl bg-white/40 p-4 ring-1 ring-zinc-200">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Cadastrar vendedor</h2>
            <p className="mt-1 text-xs text-zinc-600">O cadastro cria o usuário no Auth e o perfil em /users/{"{uid}"}.</p>
          </div>

          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-sm text-zinc-700">E-mail do vendedor</label>
              <input
                className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="vendedor@exemplo.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-zinc-700">Nome (opcional)</label>
              <input
                className="w-full rounded-xl bg-zinc-100 px-3 py-3 text-base outline-none ring-1 ring-zinc-200 focus:ring-zinc-600"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do vendedor"
              />
            </div>

            <button
              type="button"
              disabled={!newEmail || busyId === "create"}
              onClick={createVendor}
              className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busyId === "create" ? "Criando…" : "Criar vendedor"}
            </button>

            {createdTemp ? (
              <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-200 ring-1 ring-amber-500/30">
                <p className="font-semibold">Senha temporária (anote agora)</p>
                <p className="mt-1">
                  <span className="text-zinc-200">E-mail:</span> {createdTemp.email}
                </p>
                <p>
                  <span className="text-zinc-200">UID:</span> {createdTemp.uid}
                </p>
                <p className="mt-2 break-all">
                  <span className="text-zinc-200">Senha:</span> {createdTemp.tempPassword}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 ring-1 ring-zinc-200 hover:bg-zinc-800">
            Voltar
          </Link>

          <button
            onClick={() => load().catch(() => setErr("Não foi possível recarregar."))}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 ring-1 ring-zinc-200 hover:bg-zinc-800"
          >
            Recarregar
          </button>
        </div>

        {msg ? <p className="whitespace-pre-line rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200 ring-1 ring-emerald-900">{msg}</p> : null}
        {err ? <p className="whitespace-pre-line rounded-xl bg-rose-950/40 p-3 text-sm text-rose-200 ring-1 ring-rose-900">{err}</p> : null}

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <h2 className="text-base font-semibold">Edições</h2>
          <p className="mt-1 text-sm text-zinc-600">Use qualquer edição como “vigente” do vendedor.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {editions.map((e) => (
              <span key={e.id} className="rounded-full bg-zinc-900/70 px-3 py-1 text-xs text-zinc-200 ring-1 ring-zinc-200">
                {e.name} • {e.status}
              </span>
            ))}
            {editions.length === 0 ? <span className="text-sm text-zinc-600">Nenhuma edição.</span> : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <h2 className="text-base font-semibold">Vendedores</h2>
          <p className="mt-1 text-sm text-zinc-600">O vendedor não consegue mudar a edição — o app usa o activeEditionId do perfil.</p>

          <div className="mt-4 space-y-3">
            {users.map((u) => {
              const active = u.activeEditionId ? editionMap.get(u.activeEditionId) : null;
              const invalid = !!u.activeEditionId && !active;
              return (
                <div key={u.id} className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{u.email ?? u.id}</p>
                      <p className="text-xs text-zinc-600">Edição vigente: {active ? `${active.name} (${active.status})` : "— (não definida)"}</p>
                      {invalid ? (
                        <p className="mt-2 text-xs text-amber-200">
                          Valor inválido em <code>activeEditionId</code>: <code>{u.activeEditionId}</code>. Parece ser o <b>nome/número</b> da edição, não o <b>ID</b> do documento.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={u.activeEditionId ?? ""}
                        onChange={(e) => setActiveEdition(u.id, e.target.value ? e.target.value : null)}
                        disabled={busyId === u.id}
                        className="rounded-xl bg-white px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-200"
                      >
                        <option value="">Sem edição</option>
                        {editions.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} • {e.status}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Excluir este vendedor? Isso remove o usuário do Auth e apaga o perfil.")) deleteVendor(u.id);
                        }}
                        disabled={busyId === u.id}
                        className="rounded-xl bg-red-600/20 px-3 py-2 text-sm font-semibold text-red-200 ring-1 ring-red-500/30 hover:bg-red-600/30 disabled:opacity-50"
                      >
                        Excluir
                      </button>

                      {invalid ? (
                        <button
                          onClick={() => tryFixByName(u.id, u.activeEditionId!)}
                          disabled={busyId === u.id}
                          className="rounded-xl bg-amber-950/40 px-3 py-2 text-sm font-semibold text-amber-200 ring-1 ring-amber-900 hover:bg-amber-950/60"
                        >
                          Corrigir por nome
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {u.activeEditionId ? (
                    (() => {
                      const k = permKey(u.activeEditionId!, u.id);
                      const batches = perms[k] ?? [];
                      const ed = editionMap.get(u.activeEditionId!) ?? null;
                      const maxExisting = typeof ed?.nextBatch === "number" ? Math.max(0, (ed?.nextBatch ?? 1) - 1) : null;
                      const inputKey = `${k}:input`;
                      const inputVal = batchInputs[inputKey] ?? "";

                      return (
                        <div className="mt-3 rounded-xl bg-white/40 p-3 ring-1 ring-zinc-200">
                          <p className="text-xs text-zinc-600">Lotes liberados{maxExisting ? ` (existem: 1..${maxExisting})` : ""}:</p>

                          <div className="mt-2 flex flex-wrap gap-2">
                            {batches.length ? (
                              batches.map((b) => (
                                <button
                                  key={b}
                                  type="button"
                                  title="Remover lote"
                                  onClick={async () => {
                                    setErr(null);
                                    setMsg(null);
                                    setBusyId(u.id);
                                    try {
                                      await saveBatches(u.id, u.activeEditionId!, batches.filter((x) => x !== b));
                                      setMsg("Lote removido do vendedor.");
                                    } catch {
                                      setErr("Não foi possível salvar lotes. Verifique permissões.");
                                    } finally {
                                      setBusyId(null);
                                    }
                                  }}
                                  disabled={busyId === u.id}
                                  className="rounded-full bg-zinc-900/70 px-3 py-1 text-xs text-zinc-200 ring-1 ring-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                                >
                                  Lote {b} ✕
                                </button>
                              ))
                            ) : (
                              <span className="text-xs text-amber-200">Nenhum lote liberado ainda.</span>
                            )}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              value={inputVal}
                              onChange={(e) => setBatchInputs((prev) => ({ ...prev, [inputKey]: e.target.value }))}
                              placeholder="Adicionar lote (ex.: 3)"
                              className="w-44 rounded-xl bg-white px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-200 outline-none focus:ring-zinc-600"
                              disabled={busyId === u.id}
                            />

                            <button
                              type="button"
                              onClick={async () => {
                                setErr(null);
                                setMsg(null);
                                const n = Number(String(inputVal).trim());
                                if (!Number.isFinite(n) || n <= 0) {
                                  setErr("Informe um número de lote válido.");
                                  return;
                                }
                                setBusyId(u.id);
                                try {
                                  await saveBatches(u.id, u.activeEditionId!, [...batches, n]);
                                  setBatchInputs((prev) => ({ ...prev, [inputKey]: "" }));
                                  setMsg("Lote liberado para o vendedor.");
                                } catch {
                                  setErr("Não foi possível salvar lotes. Verifique permissões.");
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              disabled={busyId === u.id}
                              className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                            >
                              Adicionar
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                setErr(null);
                                setMsg(null);
                                setBusyId(u.id);
                                try {
                                  await saveBatches(u.id, u.activeEditionId!, []);
                                  setMsg("Lotes removidos do vendedor.");
                                } catch {
                                  setErr("Não foi possível remover lotes. Verifique permissões.");
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              disabled={busyId === u.id}
                              className="rounded-xl bg-rose-950/40 px-3 py-2 text-sm font-semibold text-rose-200 ring-1 ring-rose-900 hover:bg-rose-950/60 disabled:opacity-60"
                            >
                              Limpar lotes
                            </button>
                          </div>

                          <p className="mt-2 text-xs text-zinc-9000">Dica: o vendedor só consegue validar/vender cartelas que pertencem aos lotes liberados.</p>
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              );
            })}

            {users.length === 0 ? <p className="text-sm text-zinc-600">Nenhum vendedor encontrado.</p> : null}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
