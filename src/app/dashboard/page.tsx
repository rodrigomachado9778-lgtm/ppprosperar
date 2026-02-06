"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUserRole } from "@/src/lib/auth/useUserRole";
import { MobileShell } from "@/src/components/MobileShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/src/lib/firebase/client";

function Card({ title, desc, href }: { title: string; desc: string; href?: string }) {
  const inner = (
    <div className="rounded-2xl bg-zinc-950/50 p-4 ring-1 ring-zinc-800 hover:ring-zinc-700">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{desc}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Evita "flicker" (mostrar dashboard por 1 frame) enquanto carrega o auth / redireciona.
  if (loading || roleLoading) {
    return (
      <MobileShell title="Dashboard" subtitle="Resumo do sistema">
        <p className="text-sm text-zinc-400">Carregando…</p>
      </MobileShell>
    );
  }

  if (!user) return null;

  return (
    <MobileShell title="Dashboard" subtitle="Projeto Prosperar">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-400">Logado como</p>
          <p className="text-lg font-semibold">{user.email ?? "—"}</p>
        </div>

        <button
          className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700"
          onClick={async () => {
            await signOut(auth);
            router.push("/login");
          }}
        >
          Sair
        </button>
      </div>

      
<div className="mt-5 grid grid-cols-2 gap-3">
  {role === "admin" ? (
    <>
      <Card title="Edições (admin)" desc="Criar edições, gerar cartelas e iniciar sorteios" href="/admin/edicoes" />
      <Card title="Vendedores (admin)" desc="Definir edição vigente do vendedor" href="/admin/vendedores" />
    </>
  ) : null}

  <Card title="Validar cartela (vendedor)" desc="Cadastrar cartelas vendidas (login)" href="/vendedor/validar" />
  <Card title="Consulta pública" desc="Ver resultados por cartela" href="/resultado" />
</div>

      <p className="mt-4 text-xs text-zinc-500">
        Dica: o sorteio só considera cartelas com status VALIDATED (validadas pelo vendedor).
      </p>
    </MobileShell>
  );
}
