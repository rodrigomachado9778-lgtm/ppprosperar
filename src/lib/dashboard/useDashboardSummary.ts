"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { fetchWithAuth } from "@/src/lib/auth/fetchWithAuth";

export type DashboardSummary = {
  role: "admin" | "vendor";
  currentEditionId?: string | null;
  editionsList?: {
    id: string;
    name: string;
    status: string;
    createdAt: any;
    scheduledAt: any;
    roundsCount: number | null;
    cardPriceCents: number | null;
  }[];
  edition: null | {
    id: string;
    name: string;
    status: string;
    scheduledAt: any;
    youtubeUrl: string | null;
    roundsCount?: number | null;
    cardPriceCents?: number | null;
    createdAt?: any;
  };
  kpis: {
    cardsTotal: number;
    cardsValidated: number;
    cardsAvailable: number;
    salesCount: number;
    revenueCents: number;
    cardPriceCents: number;
    cardsSold: number;
    myCardsSold: number;
    mySalesCount: number;
  };
  trend: { date: string; sales: number; cards: number }[];
  topVendors: { vendorUid: string; vendorEmail: string; salesCount: number; cardsSold: number }[];
  editionDetails?: null | {
    totalPrizeCents: number;
    roundsStatusCount: Record<string, number>;
    runningRound: null | { index: number | null; drawnNumbersCount: number; startedAt: any };
  };
  pastEditions?: {
    id: string;
    name: string;
    status: string;
    scheduledAt: any;
    createdAt: any;
    roundsCount: number | null;
    cardsValidated: number;
    salesCount: number;
    cardPriceCents: number | null;
    revenueCents: number;
  }[];
};

export function useDashboardSummary() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);

  // Try to restore last selected edition (admin only) from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem("dashboardEditionId");
      if (v) setEditionId(v);
    } catch {}
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist selection.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (editionId) window.localStorage.setItem("dashboardEditionId", editionId);
      else window.localStorage.removeItem("dashboardEditionId");
    } catch {}
  }, [editionId]);

  const reload = useMemo(() => {
    return async () => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const qs = editionId ? `?editionId=${encodeURIComponent(editionId)}` : "";
        const res = await fetchWithAuth(user, `/api/dashboard/summary${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          setData(null);
          setError(String(json?.message ?? "Não foi possível carregar o dashboard."));
        } else {
          setData(json as any);
          setError(null);
        }
      } catch (e: any) {
        setData(null);
        setError("Falha de rede ao carregar o dashboard.");
      } finally {
        setLoading(false);
      }
    };
  }, [user, editionId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    reload();
  }, [authLoading, user, reload]);

  // If admin and nothing selected yet, default to current edition.
  useEffect(() => {
    if (!data) return;
    if (data.role !== "admin") return;
    if (editionId) return;
    if (data.currentEditionId) setEditionId(String(data.currentEditionId));
  }, [data, editionId]);

  return { data, loading, error, reload, editionId, setEditionId };
}
