"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/src/components/AppShell";
import { useUserRole } from "@/src/lib/auth/useUserRole";

export function SellerGuard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, authLoading, role, loading } = useUserRole();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return (
      <AppShell title={title}>
        {subtitle ? <p className="mb-3 text-xs text-zinc-600">{subtitle}</p> : null}
        <p className="text-sm text-zinc-600">Carregando…</p>
      </AppShell>
    );
  }

  if (!user) return null;

  if (role !== "admin" && role !== "vendor") {
    return (
      <AppShell title={title}>
        {subtitle ? <p className="mb-3 text-xs text-zinc-600">{subtitle}</p> : null}
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          Acesso não autorizado.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={title}>
      {subtitle ? <p className="mb-3 text-xs text-zinc-600">{subtitle}</p> : null}
      {children}
    </AppShell>
  );
}
