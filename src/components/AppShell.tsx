"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";

import { auth } from "@/src/lib/firebase/client";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useUserRole } from "@/src/lib/auth/useUserRole";

type NavItem = {
  label: string;
  href: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function buildNav(role: "admin" | "vendor" | null, loggedIn: boolean): NavItem[] {
  // Visitante (sem login)
  if (!loggedIn) {
    return [
      { label: "Resultado", href: "/resultado" },
      { label: "Entrar", href: "/login" },
    ];
  }

  // Admin
  if (role === "admin") {
    return [
      { label: "Início", href: "/dashboard" },
      { label: "Edições", href: "/admin/edicoes" },
      { label: "Vendedores", href: "/admin/vendedores" },
      { label: "Resultado", href: "/resultado" },
    ];
  }

  // Vendedor (ou fallback)
  return [
    { label: "Início", href: "/dashboard" },
    { label: "Validar", href: "/vendedor/validar" },
    { label: "Resultado", href: "/resultado" },
  ];
}

function gridColsClass(count: number) {
  if (count <= 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  return "grid-cols-4";
}

export function AppShell({
  appName = "Projeto Prosperar",
  title,
  children,
  showLogout = true,
}: {
  appName?: string;
  title?: string;
  children: React.ReactNode;
  showLogout?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { role } = useUserRole();

  const items = buildNav(role, !!user);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 overscroll-none">
      {/* TOP BAR */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4">
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">{appName}</span>
            {title ? <span className="text-xs text-zinc-600">{title}</span> : null}
          </div>

          {showLogout && user ? (
            <button
              type="button"
              className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white ring-1 ring-zinc-900/10 hover:bg-zinc-800 active:bg-zinc-950"
              onClick={async () => {
                await signOut(auth);
                router.push("/login");
              }}
            >
              Sair
            </button>
          ) : null}
        </div>
      </header>

      {/* CONTENT (sem wrapper branco externo) */}
      <main className="mx-auto w-full max-w-md px-4 pb-24 pt-20">{children}</main>

      {/* BOTTOM NAV */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/80 backdrop-blur">
        <div className={`mx-auto grid h-16 w-full max-w-md ${gridColsClass(items.length)} px-2`}>
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "mx-1 my-2 flex flex-col items-center justify-center rounded-xl text-xs font-medium transition",
                  active
                    ? "text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-800",
                ].join(" ")}

              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
