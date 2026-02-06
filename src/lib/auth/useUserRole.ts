"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/src/lib/firebase/client";
import { useAuth, type UserRole } from "@/src/lib/auth/AuthProvider";

export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  const [activeEditionId, setActiveEditionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (authLoading) return;
      if (!user) {
        if (!alive) return;
        setRole(null);
        setActiveEditionId(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? (snap.data() as any) : null;
        const r = (data?.role ?? null) as UserRole | null;
        const ae = (data?.activeEditionId ?? null) as string | null;
        if (!alive) return;
        setRole(r);
        setActiveEditionId(ae);
        setLoading(false);
      } catch {
        if (!alive) return;
        setRole(null);
        setActiveEditionId(null);
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [user, authLoading]);

  return { role, activeEditionId, loading, user, authLoading };
}
