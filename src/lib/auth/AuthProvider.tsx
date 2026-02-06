"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/src/lib/firebase/client";

export type UserRole = "admin" | "vendor";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

const Ctx = createContext<AuthCtx>({ user: null, loading: true, error: null });

/**
 * IMPORTANT (segurança):
 * - Este app NÃO cria automaticamente o perfil em /users/{uid}.
 * - Um usuário só consegue usar o sistema se já estiver cadastrado pelo ADMIN.
 * - O ADMIN deve criar vendedores via /admin/vendedores (API server com Firebase Admin SDK).
 */
async function requireExistingUserProfile(u: User) {
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("not_registered");
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      setError(null);

      if (!u) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        await requireExistingUserProfile(u);
        setUser(u);
      } catch {
        // Se não existir perfil, bloqueia o acesso.
        setUser(null);
        setError("Usuário não cadastrado. Solicite acesso ao administrador.");
        try {
          await signOut(auth);
        } catch {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  return <Ctx.Provider value={{ user, loading, error }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
