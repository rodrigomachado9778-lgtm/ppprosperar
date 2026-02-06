"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileShell } from "@/src/components/MobileShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/src/lib/firebase/client";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, error } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResetMsg(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.push("/dashboard");
    } catch (e: any) {
      setErr("E-mail ou senha inválidos (ou usuário não existe).");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setErr(null);
    setResetMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErr("Digite seu e-mail acima para receber o link de redefinição de senha.");
      return;
    }

    setResetBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setResetMsg("Pronto! Se esse e-mail existir, você vai receber um link para redefinir a senha.");
    } catch (e: any) {
      // Mantém mensagem genérica para não revelar se o e-mail existe ou não.
      setResetMsg("Se esse e-mail existir, você vai receber um link para redefinir a senha.");
    } finally {
      setResetBusy(false);
    }
  }

  // Evita "flicker" enquanto o AuthProvider resolve o estado.
  if (loading) {
    return (
      <MobileShell title="Entrar" subtitle="Painel do Bingo">
        <p className="text-sm text-zinc-400">Carregando…</p>
      </MobileShell>
    );
  }

  if (user) return null;

  return (
    <MobileShell title="Entrar" subtitle="Painel do Bingo">
      {(error || err) && (
        <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          {error ?? err}
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-300">E-mail</label>
          <input
            className="w-full rounded-xl bg-zinc-950/60 px-3 py-3 text-base outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-300">Senha</label>
          <input
            className="w-full rounded-xl bg-zinc-950/60 px-3 py-3 text-base outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {resetMsg && (
          <p className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200 ring-1 ring-emerald-500/30">
            {resetMsg}
          </p>
        )}

        <button
          className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-zinc-950 disabled:opacity-60"
          disabled={busy || resetBusy}
          type="submit"
        >
          {busy ? "Entrando..." : "Entrar"}
        </button>

        <button
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-100 ring-1 ring-zinc-800 disabled:opacity-60"
          type="button"
          disabled={busy || resetBusy}
          onClick={onForgotPassword}
        >
          {resetBusy ? "Enviando link..." : "Esqueci minha senha"}
        </button>

        <p className="text-xs text-zinc-400">
          Obs.: não há tela de cadastro. Peça para o administrador criar seu acesso.
        </p>
      </form>
    </MobileShell>
  );
}
