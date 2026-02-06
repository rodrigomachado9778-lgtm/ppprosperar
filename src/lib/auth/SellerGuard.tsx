"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MobileShell } from "@/src/components/MobileShell";
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
      <MobileShell title={title} subtitle={subtitle}>
        <p className="text-sm text-zinc-400">Carregando…</p>
      </MobileShell>
    );
  }

  if (!user) return null;

  if (role !== "admin" && role !== "vendor") {
    return (
      <MobileShell title={title} subtitle={subtitle}>
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          Acesso não autorizado.
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell title={title} subtitle={subtitle}>
      {children}
    </MobileShell>
  );
}
