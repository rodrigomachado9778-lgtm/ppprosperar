"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import { AdminGuard } from "@/src/lib/auth/AdminGuard";
import type { Edition } from "@/src/lib/prosperar/types";

export default function EditionHome() {
  const params = useParams<{ id: string }>();
  const editionId = useMemo(() => {
    const v = (params as any)?.id;
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  }, [params]);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!editionId) {
      setLoading(false);
      return;
    }
    (async () => {
      const ref = doc(db, "editions", editionId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setEdition({ id: snap.id, ...(snap.data() as any) });
      } else {
        setEdition(null);
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [editionId]);

  return (
    <AdminGuard title="Edição" subtitle="Gerenciar cartelas, prêmios e sorteio">
      {loading ? (
        <p className="text-sm text-zinc-400">Carregando…</p>
      ) : !edition ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          Edição não encontrada.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-950/50 p-4 ring-1 ring-zinc-800">
            <p className="text-sm text-zinc-400">Nome</p>
            <p className="text-lg font-semibold">{edition.name}</p>
            <p className="mt-1 text-sm text-zinc-400">Status: {edition.status}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Link
              href={`/admin/edicoes/${edition.id}/cartelas`}
              className="rounded-2xl bg-zinc-950/50 p-4 ring-1 ring-zinc-800 hover:ring-zinc-700"
            >
              <h3 className="text-base font-semibold">Cartelas</h3>
              <p className="mt-1 text-sm text-zinc-400">Cadastrar/Importar cartelas (20 números)</p>
            </Link>

            <Link
              href={`/admin/edicoes/${edition.id}/sorteio`}
              className="rounded-2xl bg-zinc-950/50 p-4 ring-1 ring-zinc-800 hover:ring-zinc-700"
            >
              <h3 className="text-base font-semibold">Sorteio (manual)</h3>
              <p className="mt-1 text-sm text-zinc-400">Marcar números (1–50) e apurar ganhadores</p>
            </Link>
          </div>

          <Link
            href="/admin/edicoes"
            className="inline-flex text-sm text-zinc-300 underline decoration-zinc-600 hover:text-zinc-100"
          >
            ← Voltar para edições
          </Link>
        </div>
      )}
    </AdminGuard>
  );
}
