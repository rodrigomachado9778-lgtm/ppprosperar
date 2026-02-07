"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "@/src/lib/firebase/client";
import { SellerGuard } from "@/src/lib/auth/SellerGuard";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useUserRole } from "@/src/lib/auth/useUserRole";
import type { Edition } from "@/src/lib/prosperar/types";
import { parseCardNumbersBatch, formatPrintedNumber } from "@/src/lib/prosperar/format";
import { cpfToHash } from "@/src/lib/prosperar/buyers";

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

function normalizePhoneBR(value: string): { ok: boolean; e164?: string; message?: string } {
  const d = onlyDigits(value);
  if (!d) return { ok: false, message: "Informe o telefone." };

  let digits = d;
  if (!digits.startsWith("55")) digits = "55" + digits;

  // 55 + DDD(2) + número(8 ou 9) => 12 ou 13 dígitos
  if (!(digits.length === 12 || digits.length === 13)) {
    return { ok: false, message: "Telefone inválido. Use DDD + número (ex.: 11999999999)." };
  }

  return { ok: true, e164: "+" + digits };
}

function validateCPF(value: string): { ok: boolean; digits?: string; message?: string } {
  const cpf = onlyDigits(value);

  if (cpf.length !== 11) return { ok: false, message: "CPF inválido (deve ter 11 dígitos)." };
  if (/^(\d)\1{10}$/.test(cpf)) return { ok: false, message: "CPF inválido." };

  const calc = (base: string, factor: number) => {
    let total = 0;
    for (const ch of base) total += Number(ch) * factor--;
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 9) + String(d1), 11);

  if (String(d1) !== cpf[9] || String(d2) !== cpf[10]) return { ok: false, message: "CPF inválido." };

  return { ok: true, digits: cpf };
}

type Buyer = {
  id: string;
  name: string;
  phoneE164: string;
  cpfHash: string;
  cpfLast4: string;
};

type SaleRow = {
  id: string;
  createdAt?: any;
  buyerNameSnapshot: string;
  buyerPhoneSnapshot: string;
  buyerCpfLast4Snapshot: string;
  cardPrintedNumbers: string[];
};

function createdAtSeconds(v: any): number {
  // Firestore Timestamp tem seconds
  if (!v) return 0;
  if (typeof v.seconds === "number") return v.seconds;

  // fallback (caso venha Date/string)
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export default function CadastroVendasPage() {
  const { user } = useAuth();
  const { activeEditionId } = useUserRole();

  const [edition, setEdition] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(true);
  const [editionIdHint, setEditionIdHint] = useState<{ name: string; id: string } | null>(null);

  // Lotes (batches) liberados para este vendedor na edição ativa.
  const [allowedBatches, setAllowedBatches] = useState<number[]>([]);

  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerCpf, setBuyerCpf] = useState("");

  const [buyerFound, setBuyerFound] = useState<Buyer | null>(null);
  const [findingBuyer, setFindingBuyer] = useState(false);
  const lastLookupKey = useRef<string>("");

  const [batchText, setBatchText] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<{ ok: string[]; bad: string[] } | null>(null);

  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [salesErr, setSalesErr] = useState<string | null>(null);

  const canRegister = useMemo(() => {
    if (!edition) return false;
    return edition.status !== "RUNNING" && edition.status !== "FINISHED";
  }, [edition]);

  const minDigits = useMemo(() => Number(edition?.cardNumberMinDigits ?? 4), [edition?.cardNumberMinDigits]);

  // Carrega edição do vendedor (activeEditionId deve ser o ID real do doc)
  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setEdition(null);
      setEditionIdHint(null);
      setAllowedBatches([]);

      if (!activeEditionId) {
        if (alive) setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "editions", activeEditionId));

        if (!snap.exists()) {
          // Caso comum: activeEditionId foi salvo como "nome" (ex.: 0004). Tentamos achar pelo campo name.
          try {
            const qByName = query(collection(db, "editions"), where("name", "==", activeEditionId), limit(2));
            const s = await getDocs(qByName);
            if (alive && s.size === 1) {
              const d = s.docs[0];
              const data = d.data() as any;
              setEditionIdHint({ name: String(data.name ?? activeEditionId), id: d.id });
            }
          } catch {
            // ignora
          }

          return;
        }

        if (!alive) return;

        setEdition({ id: snap.id, ...(snap.data() as any) });

        // Carrega permissões de lotes (batches) deste vendedor nesta edição.
        if (user?.uid) {
          try {
            const pSnap = await getDoc(doc(db, "editions", snap.id, "vendor_permissions", user.uid));
            const arr = (pSnap.exists() ? ((pSnap.data() as any).batches ?? []) : []) as any[];
            const batches = arr
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x) && x > 0)
              .sort((a, b) => a - b);
            if (alive) setAllowedBatches(Array.from(new Set(batches)));
          } catch {
            if (alive) setAllowedBatches([]);
          }
        }
      } catch (e) {
        console.error("LOAD EDITION ERROR:", e);
        if (alive) setEdition(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [activeEditionId, user?.uid]);

  // ✅ Buscar vendas recentes do vendedor SEM índice composto (sem orderBy no Firestore)
  useEffect(() => {
    let alive = true;

    async function loadSales() {
      setSalesErr(null);
      setSales(null);

      if (!user || !edition) return;

      try {
        // Sem orderBy => não exige índice composto
        const qSales = query(
          collection(db, "editions", edition.id, "sales"),
          where("vendorUid", "==", user.uid),
          limit(100),
        );

        const snap = await getDocs(qSales);
        const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

        rows.sort((a, b) => createdAtSeconds(b.createdAt) - createdAtSeconds(a.createdAt));

        if (!alive) return;
        setSales(rows.slice(0, 20));
      } catch (e: any) {
        console.error("LOAD SALES ERROR:", e?.code, e?.message, e);
        if (!alive) return;
        setSalesErr("Não foi possível carregar suas vendas recentes.");
        setSales([]);
      }
    }

    loadSales();
    return () => {
      alive = false;
    };
  }, [user, edition]);

  // Autopreenchimento de comprador por CPF ou telefone
  useEffect(() => {
    let alive = true;

    async function lookupBuyer() {
      setErr(null);
      setBuyerFound(null);

      if (!user) return;
      if (!edition) return;

      const phone = normalizePhoneBR(buyerPhone);
      const cpf = validateCPF(buyerCpf);

      const phoneKey = phone.ok && phone.e164 ? `phone:${phone.e164}` : "";
      const cpfKey = cpf.ok && cpf.digits ? `cpf:${cpf.digits}` : "";
      const key = [phoneKey, cpfKey].filter(Boolean).join("|");
      if (!key) return;

      // Evita chamadas repetidas enquanto digita
      if (lastLookupKey.current === key) return;
      lastLookupKey.current = key;

      setFindingBuyer(true);
      try {
        let buyerIdFromPhone: string | null = null;
        let buyerIdFromCpf: string | null = null;

        if (phone.ok && phone.e164) {
          const s = await getDoc(doc(db, "buyers_lookup_phone", phone.e164));
          buyerIdFromPhone = s.exists() ? String((s.data() as any).buyerId) : null;
        }

        if (cpf.ok && cpf.digits) {
          const hash = await cpfToHash(cpf.digits);
          const s = await getDoc(doc(db, "buyers_lookup_cpf", hash));
          buyerIdFromCpf = s.exists() ? String((s.data() as any).buyerId) : null;
        }

        // Se ambos existem e apontam para pessoas diferentes, sinaliza conflito
        if (buyerIdFromPhone && buyerIdFromCpf && buyerIdFromPhone !== buyerIdFromCpf) {
          if (!alive) return;
          setErr("Conflito: este telefone parece estar associado a outro CPF. Confira antes de continuar.");
          setBuyerFound(null);
          return;
        }

        const buyerId = buyerIdFromCpf ?? buyerIdFromPhone;
        if (!buyerId) {
          if (!alive) return;
          setBuyerFound(null);
          return;
        }

        const bSnap = await getDoc(doc(db, "buyers", buyerId));
        if (!bSnap.exists()) {
          if (!alive) return;
          setBuyerFound(null);
          return;
        }

        const b = bSnap.data() as any;
        const found: Buyer = {
          id: buyerId,
          name: String(b.name ?? ""),
          phoneE164: String(b.phoneE164 ?? ""),
          cpfHash: String(b.cpfHash ?? ""),
          cpfLast4: String(b.cpfLast4 ?? ""),
        };

        if (!alive) return;
        setBuyerFound(found);

        // Autopreenche
        if (!buyerName.trim() && found.name) setBuyerName(found.name);
        if ((!buyerPhone.trim() || !phone.ok) && found.phoneE164) setBuyerPhone(found.phoneE164);
        // CPF: não reescreve (LGPD). Mostra last4 na UI.
      } catch (e: any) {
        console.error("LOOKUP BUYER ERROR:", e?.code, e?.message, e);
      } finally {
        if (alive) setFindingBuyer(false);
      }
    }

    lookupBuyer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      alive = false;
    };
  }, [buyerPhone, buyerCpf, edition, user]);

  async function reloadSalesBestEffort(editionId: string, vendorUid: string) {
    try {
      const qSales = query(
        collection(db, "editions", editionId, "sales"),
        where("vendorUid", "==", vendorUid),
        limit(100),
      );
      const snap = await getDocs(qSales);
      const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => createdAtSeconds(b.createdAt) - createdAtSeconds(a.createdAt));
      setSales(rows.slice(0, 20));
    } catch {
      // ignore
    }
  }

  async function onRegister() {
    setMsg(null);
    setErr(null);
    setReport(null);

    if (!user) return;

    if (!edition) {
      setErr("Nenhuma edição atribuída ao vendedor. Peça ao administrador para configurar.");
      return;
    }

    if (!canRegister) {
      setErr("Cadastro bloqueado: o sorteio já foi iniciado nesta edição.");
      return;
    }

    const name = buyerName.trim();
    if (name.length < 3) {
      setErr("Informe o nome completo do comprador.");
      return;
    }

    const phone = normalizePhoneBR(buyerPhone);
    if (!phone.ok || !phone.e164) {
      setErr(phone.message ?? "Telefone inválido.");
      return;
    }
    // ✅ congela como string (evita string | undefined dentro do runTransaction)
    const phoneE164: string = phone.e164;

    const cpf = validateCPF(buyerCpf);
    if (!cpf.ok || !cpf.digits) {
      setErr(cpf.message ?? "CPF inválido.");
      return;
    }
    // ✅ congela como string
    const cpfDigits: string = cpf.digits;

    // Lookup hash (server-salted) used by the public /resultado page (CPF + telefone).
    // We generate it server-side to avoid exposing the secret salt.
    const idToken = await user.getIdToken();
    const getLookupHash = async (phone: string) => {
      const r = await fetch("/api/internal/lookup-hash", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ phone, cpf: cpfDigits }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.hash) throw new Error("lookup_hash_failed");
      return String(j.hash);
    };

    // ⚠️ If LOOKUP_HASH_SALT is not configured yet, the endpoint will fail.
    // This hash is ONLY used to enable the public /resultado page (CPF + telefone).
    // Do not block sales registration if the hash cannot be generated.
    let buyerLookupHash: string | null = null;
    let prevBuyerLookupHash: string | null = null;
    try {
      buyerLookupHash = await getLookupHash(phoneE164);
      prevBuyerLookupHash =
        buyerFound?.phoneE164 && buyerFound.phoneE164 !== phoneE164 ? await getLookupHash(buyerFound.phoneE164) : null;
    } catch {
      // best-effort: sales can proceed; /resultado will work after LOOKUP_HASH_SALT is set.
      buyerLookupHash = null;
      prevBuyerLookupHash = null;
    }

    const nums = parseCardNumbersBatch(batchText);
    if (nums.length === 0) {
      setErr("Informe pelo menos um número de cartela.");
      return;
    }
    if (nums.length > 100) {
      setErr("Por segurança, cadastre no máximo 100 cartelas por vez.");
      return;
    }

    setBusy(true);

    try {
      // Prefer server-side validation (avoids Firestore rules/transaction edge cases).
      // If the API is not available, we fall back to the legacy client transaction below.
      try {
        const idToken = await user.getIdToken();
        const resp = await fetch("/api/vendor/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            editionId: edition.id,
            cardPublicNumbers: nums,
            buyerName,
            buyerPhoneE164: phoneE164,
            buyerCpfDigits: cpfDigits,
          }),
        });

        const json = await resp.json().catch(() => ({}));
        if (resp.ok && json?.ok) {
          const md = Number(edition.cardNumberMinDigits ?? 4);
          const okNums = Array.isArray(json.okNums) ? json.okNums : [];
          const okPrinted = okNums.map((n: any) => formatPrintedNumber(Number(n), md));
          const badPrinted = Array.isArray(json.bad) ? json.bad.map(String) : [];

          setReport({ ok: okPrinted, bad: badPrinted });
          setMsg(`Cadastro concluído. Cartelas validadas: ${okPrinted.length}.`);

          await reloadSalesBestEffort(edition.id, user.uid);

          setBuyerName("");
          setBuyerPhone("");
          setBuyerCpf("");
          setBatchText("");
          setBuyerFound(null);
          lastLookupKey.current = "";
          return;
        }

        // API responded with an error we can show.
        const message = String(json?.message ?? "");
        if (Array.isArray(json?.bad)) {
          setReport({ ok: [], bad: json.bad.map(String) });
        }
        if (message) throw new Error(message);
      } catch (e) {
        // Ignore and fall back to the legacy Firestore transaction.
      }

      // Pré-busca dos docs de cartela (fora da tx)
      const cardRefs: { publicNumberInt: number; cardDocId: string }[] = [];
      const notFound: number[] = [];

      for (const n of nums) {
        const qCard = query(collection(db, "editions", edition.id, "cards"), where("publicNumberInt", "==", n), limit(1));
        const snap = await getDocs(qCard);
        if (snap.empty) notFound.push(n);
        else cardRefs.push({ publicNumberInt: n, cardDocId: snap.docs[0].id });
      }

      // MODO ESTRITO: se alguma cartela não existir, não registra a venda.
      if (notFound.length) {
        const md = Number(edition.cardNumberMinDigits ?? 4);
        const badPrinted = notFound.map((n) => `${formatPrintedNumber(n, md)} (não encontrada)`);
        setReport({ ok: [], bad: badPrinted });
        setErr("Uma ou mais cartelas não foram encontradas. Nenhuma venda foi registrada.");
        return;
      }

      const cpfHash = await cpfToHash(cpfDigits);
      const cpfLast4 = cpfDigits.slice(-4);

      // ✅ TRANSACTION CORRIGIDA: todos os reads antes de writes
      const result = await runTransaction(db, async (tx) => {
        // ==========================================================
        // REGRA DO FIRESTORE:
        // dentro da transaction, TODOS os reads (tx.get) devem ocorrer
        // antes de QUALQUER write (tx.set/tx.update/tx.delete).
        // ==========================================================

        // ---------------- READS (SOMENTE tx.get) ----------------
        // Revalida status da edição
        const edRef = doc(db, "editions", edition.id);
        const edSnap = await tx.get(edRef);
        if (!edSnap.exists()) throw new Error("edition_not_found");

        const edData = edSnap.data() as any;
        const status = String(edData.status ?? "READY");
        if (status === "RUNNING" || status === "FINISHED") throw new Error("sales_locked");

        // Permissões de lotes (batches) do vendedor nesta edição
        const permRef = doc(db, "editions", edition.id, "vendor_permissions", user.uid);
        const permSnap = await tx.get(permRef);
        const permArr = (permSnap.exists() ? ((permSnap.data() as any).batches ?? []) : []) as any[];
        const allowed = permArr
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0);
        if (!allowed.length) throw new Error("no_batches");
        const allowedSet = new Set<number>(allowed);

        const md = Number(edData.cardNumberMinDigits ?? 4);

        // Snapshot do vendedor (para registrar e para explicar "já cadastrada por quem")
        const vendorUserRef = doc(db, "users", user.uid);
        const vendorUserSnap = await tx.get(vendorUserRef);
        const vendorEmailSnapshot = vendorUserSnap.exists() ? String((vendorUserSnap.data() as any).email ?? "") : "";


        // Lookups do comprador
        const phoneLookupRef = doc(db, "buyers_lookup_phone", phoneE164);
        const cpfLookupRef = doc(db, "buyers_lookup_cpf", cpfHash);

        // Public /resultado lookup (server-salted hash). Never readable publicly.
        // This is optional: if LOOKUP_HASH_SALT isn't configured yet, we skip this index.
        const buyerHashLookupRef = buyerLookupHash ? doc(db, "buyers_lookup_hash", buyerLookupHash) : null;
        const prevBuyerHashLookupRef =
          buyerHashLookupRef && prevBuyerLookupHash && prevBuyerLookupHash !== buyerLookupHash
            ? doc(db, "buyers_lookup_hash", prevBuyerLookupHash)
            : null;

        const phoneLookupSnap = await tx.get(phoneLookupRef);
        const cpfLookupSnap = await tx.get(cpfLookupRef);

        const buyerHashLookupSnap = buyerHashLookupRef ? await tx.get(buyerHashLookupRef) : null;
        // (optional) we may delete the previous hash index after writes
        const prevBuyerHashLookupSnap = prevBuyerHashLookupRef ? await tx.get(prevBuyerHashLookupRef) : null;

        const phoneBuyerId = phoneLookupSnap.exists() ? String((phoneLookupSnap.data() as any).buyerId ?? "") : "";
        const cpfBuyerId = cpfLookupSnap.exists() ? String((cpfLookupSnap.data() as any).buyerId ?? "") : "";

        const hashBuyerId = buyerHashLookupSnap?.exists() ? String((buyerHashLookupSnap.data() as any).buyerId ?? "") : "";
        if (hashBuyerId && cpfBuyerId && hashBuyerId !== cpfBuyerId) throw new Error("buyer_conflict");
        if (hashBuyerId && phoneBuyerId && hashBuyerId !== phoneBuyerId) throw new Error("buyer_conflict");

        if (phoneBuyerId && cpfBuyerId && phoneBuyerId !== cpfBuyerId) {
          throw new Error("buyer_conflict");
        }

        const buyerId = cpfBuyerId || phoneBuyerId || doc(collection(db, "buyers")).id;
        const buyerRef = doc(db, "buyers", buyerId);
        const buyerSnap = await tx.get(buyerRef);

        // Se buyer existe e telefone mudou, precisamos ler o lookup antigo ANTES de qualquer delete
        let prevLookupRef: ReturnType<typeof doc> | null = null;
        let prevLookupSnap: any = null;

        if (buyerSnap.exists()) {
          const b = buyerSnap.data() as any;
          const prevPhone = String(b.phoneE164 ?? "");
          if (prevPhone && prevPhone !== phoneE164) {
            prevLookupRef = doc(db, "buyers_lookup_phone", prevPhone);
            prevLookupSnap = await tx.get(prevLookupRef);
          }
        }

        // Ler todas as cartelas ANTES de atualizar qualquer uma
        const cardReadItems = cardRefs.map((it) => ({
          it,
          ref: doc(db, "editions", edition.id, "cards", it.cardDocId),
        }));

        const cardSnaps = await Promise.all(cardReadItems.map((x) => tx.get(x.ref)));

        // Pré-carrega vendas referenciadas por cartelas já VALIDATED (para explicar "por quem" e "para quem")
        const saleIdSet = new Set<string>();
        for (const s of cardSnaps) {
          if (!s.exists()) continue;
          const d = s.data() as any;
          if (String(d.status) === "VALIDATED" && d.saleId) {
            saleIdSet.add(String(d.saleId));
          }
        }
        const saleDocs: Record<string, any> = {};
        if (saleIdSet.size) {
          const saleRefs = Array.from(saleIdSet).map((sid) => ({
            sid,
            ref: doc(db, "editions", edition.id, "sales", sid),
          }));
          const saleSnaps = await Promise.all(saleRefs.map((x) => tx.get(x.ref)));
          for (let i = 0; i < saleRefs.length; i++) {
            if (saleSnaps[i].exists()) saleDocs[saleRefs[i].sid] = saleSnaps[i].data();
          }
        }


        // ---- venda (determinística por comprador+vendedor) ----
        // Regra de negócio:
        // - Se o mesmo comprador comprar novamente do MESMO vendedor, anexamos as cartelas na MESMA venda.
        // - Se comprar de outro vendedor, será outra venda (outro doc).
        const saleId = `${buyerId}_${user.uid}`;
        const saleRef = doc(db, "editions", edition.id, "sales", saleId);
        const saleSnap = await tx.get(saleRef);

        // ----------------------------------------------------------
        // MODO ESTRITO: se qualquer cartela falhar, NÃO registra nada.
        // Para garantir isso, validamos tudo primeiro (sem writes),
        // e só depois fazemos os updates / sale / buyer.
        // ----------------------------------------------------------
        const okNums: number[] = [];
        const badMsgs: string[] = [];
        const okCardRefs: ReturnType<typeof doc>[] = [];

        for (let i = 0; i < cardReadItems.length; i++) {
          const { it, ref: cRef } = cardReadItems[i];
          const cSnap = cardSnaps[i];

          if (!cSnap.exists()) {
            badMsgs.push(`${formatPrintedNumber(it.publicNumberInt, md)} (não encontrada)`);
            continue;
          }

          const c = cSnap.data() as any;
          const batchNum = Number(c.batch ?? 0);

          if (!allowedSet.has(batchNum)) {
            const allowedList = Array.from(allowedSet).sort((a,b)=>a-b).join(", ");
            badMsgs.push(`${formatPrintedNumber(it.publicNumberInt, md)} (lote ${batchNum || "?"} não liberado para você; liberados: ${allowedList || "-"})`);
            continue;
          }

          if (c.status === "VALIDATED") {
            const saleId = c.saleId ? String(c.saleId) : "";
            const sale = saleId ? (saleDocs[saleId] as any) : null;
            const byVendor = sale?.vendorEmailSnapshot ? String(sale.vendorEmailSnapshot) : (sale?.vendorUid ? String(sale.vendorUid) : (c.validatedByUid ? String(c.validatedByUid) : ""));
            const buyerName = sale?.buyerNameSnapshot ? String(sale.buyerNameSnapshot) : "";
            const at = c.validatedAt?.toDate ? c.validatedAt.toDate() : null;
            const atStr = at ? at.toLocaleString("pt-BR") : "";
            const parts = [
              "já cadastrada",
              byVendor ? `vendedor: ${byVendor}` : "",
              buyerName ? `comprador: ${buyerName}` : "",
              atStr ? `em: ${atStr}` : "",
            ].filter(Boolean);
            badMsgs.push(`${formatPrintedNumber(it.publicNumberInt, md)} (${parts.join("; ")})`);
            continue;
          }

          if (c.status !== "AVAILABLE") {
            badMsgs.push(`${formatPrintedNumber(it.publicNumberInt, md)} (estado inválido: ${String(c.status ?? "-")})`);
            continue;
          }

          okNums.push(it.publicNumberInt);
          okCardRefs.push(cRef);
        }

	        // MODO ESTRITO: qualquer falha cancela tudo (mesmo que existam cartelas OK)
	        if (badMsgs.length) {
          // serializa falhas para exibir fora da tx
          throw new Error(`strict_failed|${badMsgs.join(";;")}`);
        }

	        // Se não houve falhas, mas também não houve cartelas válidas, não registra nada.
	        if (!okNums.length) throw new Error("no_valid_cards");

        // Agora que todas passaram na validação, podemos escrever.
        for (const cRef of okCardRefs) {
          tx.update(cRef, {
            status: "VALIDATED",
            validatedAt: serverTimestamp(),
            validatedByUid: user.uid,
            saleId: saleRef.id,
          });
        }

        // ---------------- WRITES (tx.set/tx.update/tx.delete) ----------------
        // resolve/cria/atualiza buyer + lookups
        if (buyerSnap.exists()) {
          const b = buyerSnap.data() as any;
          const prevPhone = String(b.phoneE164 ?? "");
          const prevName = String(b.name ?? "");
          const prevCpfHash = String(b.cpfHash ?? "");

          if (prevCpfHash && prevCpfHash !== cpfHash) {
            throw new Error("buyer_conflict");
          }

          // CPF lookup: se existir e apontar para outra pessoa, bloqueia
          if (cpfLookupSnap.exists()) {
            const existingBuyerId = String((cpfLookupSnap.data() as any).buyerId ?? "");
            if (existingBuyerId && existingBuyerId !== buyerId) throw new Error("cpf_already_used");
          } else {
            tx.set(cpfLookupRef, { buyerId });
          }

          const updates: any = {
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          };

          if (name && name !== prevName) updates.name = name;

          // Telefone mudou: move lookup antigo
          if (phoneE164 !== prevPhone) {
            updates.phoneE164 = phoneE164;

            if (prevLookupRef && prevLookupSnap?.exists()) {
              tx.delete(prevLookupRef);
            }

            if (phoneLookupSnap.exists()) {
              const existingBuyerId = String((phoneLookupSnap.data() as any).buyerId ?? "");
              if (existingBuyerId && existingBuyerId !== buyerId) throw new Error("phone_already_used");
            } else {
              tx.set(phoneLookupRef, { buyerId });
            }
          } else {
            if (!phoneLookupSnap.exists()) tx.set(phoneLookupRef, { buyerId });
          }

          if (!prevCpfHash) {
            updates.cpfHash = cpfHash;
            updates.cpfLast4 = cpfLast4;
          }

          // Index for public /resultado (CPF + telefone). Optional.
          if (buyerHashLookupRef && buyerHashLookupSnap) {
            if (buyerHashLookupSnap.exists()) {
              const existingBuyerId = String((buyerHashLookupSnap.data() as any).buyerId ?? "");
              if (existingBuyerId && existingBuyerId !== buyerId) throw new Error("buyer_conflict");
            } else {
              tx.set(buyerHashLookupRef, { buyerId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            }
            // If phone changed, remove old hash index (best-effort)
            if (prevBuyerHashLookupRef && prevBuyerHashLookupSnap?.exists()) {
              const prevId = String((prevBuyerHashLookupSnap.data() as any).buyerId ?? "");
              if (!prevId || prevId === buyerId) {
                tx.delete(prevBuyerHashLookupRef);
              }
            }
          }

          tx.update(buyerRef, updates);
        } else {
          if (cpfBuyerId && cpfBuyerId !== buyerId) throw new Error("cpf_already_used");
          if (phoneBuyerId && phoneBuyerId !== buyerId) throw new Error("phone_already_used");

          tx.set(buyerRef, {
            name,
            phoneE164,
            cpfHash,
            cpfLast4,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          });

          if (!phoneLookupSnap.exists()) tx.set(phoneLookupRef, { buyerId });
          if (!cpfLookupSnap.exists()) tx.set(cpfLookupRef, { buyerId });

          // Index for public /resultado (CPF + telefone) - optional
          if (buyerHashLookupRef && buyerHashLookupSnap) {
            if (buyerHashLookupSnap.exists()) {
              const existingBuyerId = String((buyerHashLookupSnap.data() as any).buyerId ?? "");
              if (existingBuyerId && existingBuyerId !== buyerId) throw new Error("buyer_conflict");
            } else {
              tx.set(buyerHashLookupRef, { buyerId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            }
          }
        }


        const okPrintedNumbers = okNums.map((n) => formatPrintedNumber(n, md));

        const incomingPublic = okNums.map((n) => String(n));
        const incomingPrinted = okPrintedNumbers;

        if (saleSnap.exists()) {
          const s = saleSnap.data() as any;
          const prevPublic = Array.isArray(s.cardPublicNumbers) ? (s.cardPublicNumbers as any[]).map(String) : [];
          const prevPrinted = Array.isArray(s.cardPrintedNumbers) ? (s.cardPrintedNumbers as any[]).map(String) : [];

          // Garante append sem duplicar (defensivo)
          const nextPublic = [...prevPublic];
          for (const n of incomingPublic) if (!nextPublic.includes(n)) nextPublic.push(n);
          const nextPrinted = [...prevPrinted];
          for (const p of incomingPrinted) if (!nextPrinted.includes(p)) nextPrinted.push(p);

          tx.update(saleRef, {
            buyerNameSnapshot: name,
            buyerPhoneSnapshot: phoneE164,
            buyerCpfLast4Snapshot: cpfLast4,
            // Mantém o snapshot antigo (se existir) ou grava o email atual do vendedor.
            vendorEmailSnapshot: (s.vendorEmailSnapshot ? String(s.vendorEmailSnapshot) : "") || vendorEmailSnapshot,
            cardPrintedNumbers: nextPrinted,
            cardPublicNumbers: nextPublic,
            updatedAt: serverTimestamp(),
            lastPurchaseAt: serverTimestamp(),
          });
        } else {
          tx.set(saleRef, {
            buyerId,
            buyerNameSnapshot: name,
            buyerPhoneSnapshot: phoneE164,
            buyerCpfLast4Snapshot: cpfLast4,
            vendorUid: user.uid,
            vendorEmailSnapshot,
            cardPrintedNumbers: incomingPrinted,
            cardPublicNumbers: incomingPublic,
            createdAt: serverTimestamp(),
            lastPurchaseAt: serverTimestamp(),
          });
        }

        return { saleId: saleRef.id, okNums, badMsgs, md };
      });

      const okPrinted = result.okNums.map((n) => formatPrintedNumber(n, result.md));
      const badPrinted = [...result.badMsgs];

      setReport({ ok: okPrinted, bad: badPrinted });
      setMsg(`Cadastro concluído. Cartelas validadas: ${okPrinted.length}.`);

      // ✅ Recarrega vendas (best effort / sem índice)
      await reloadSalesBestEffort(edition.id, user.uid);

      // Limpa formulário
      setBuyerName("");
      setBuyerPhone("");
      setBuyerCpf("");
      setBatchText("");
      setBuyerFound(null);
      lastLookupKey.current = "";
	} catch (e: any) {
	  // Evita o "red box" do Next em dev por console.error em handlers.
	  console.warn("CADASTRO ERROR:", e?.code, e?.message, e);
      const m = String(e?.message ?? "");

      if (String(e?.code ?? "") === "permission-denied") {
        setErr("Permissão negada: verifique se você está liberado para o lote dessa cartela e se ela ainda não foi vendida.");
        return;
      }

      if (m === "sales_locked") {
        setErr("Cadastro bloqueado: o sorteio já foi iniciado nesta edição.");
      } else if (m === "no_batches") {
        setErr("Você ainda não tem nenhum lote liberado para venda nesta edição. Peça ao administrador para atribuir um ou mais lotes.");
	  } else if (m === "no_valid_cards") {
	    setReport({ ok: [], bad: ["Nenhuma cartela válida para cadastrar."] });
	    setErr("Nenhuma cartela válida para cadastrar. Verifique se os números existem e se você está liberado para o lote.");
      } else if (m.startsWith("strict_failed|")) {
        const raw = m.slice("strict_failed|".length);
        const bad = raw ? raw.split(";;").filter(Boolean) : [];
        setReport({ ok: [], bad });
        setErr("Uma ou mais cartelas falharam. Nenhuma venda foi registrada.");
      } else if (m === "buyer_conflict") {
        setErr("Conflito entre CPF e telefone. Confira os dados do comprador antes de continuar.");
      } else if (m === "cpf_already_used") {
        setErr("Este CPF já está cadastrado para outro comprador. Confira antes de continuar.");
      } else if (m === "phone_already_used") {
        setErr("Este telefone já está cadastrado para outro comprador. Confira antes de continuar.");
	  } else if (m === "hash_already_used") {
	    setErr("Não foi possível vincular CPF+telefone a este comprador. Confira os dados e tente novamente.");
	  } else if (m === "lookup_hash_failed") {
	    setErr("Não foi possível validar CPF+telefone agora. Tente novamente.");
      } else if (m === "edition_not_found") {
        setErr("Edição não encontrada. Peça ao administrador para revisar a configuração.");
      } else {
        setErr("Não foi possível cadastrar agora. Verifique permissões e conexão.");
      }
    } finally {
      setBusy(false);
    }
  }

  const showNoEdition = !loading && !edition;
  const showEditionHint = showNoEdition && !!editionIdHint;

  return (
    <SellerGuard title="Cadastro (vendas)" subtitle="Vendedor • cadastrar comprador e validar cartelas">
      <div className="space-y-6">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-600">Edição atribuída</p>
              <p className="text-base font-semibold">{edition?.name ?? (loading ? "Carregando…" : "—")}</p>
              <p className="mt-1 text-sm text-zinc-600">Status: {edition?.status ?? "—"}</p>

              {showNoEdition ? (
                <p className="mt-2 text-xs text-amber-200">
                  Nenhuma edição ativa foi atribuída ao seu usuário.
                  {showEditionHint ? (
                    <>
                      {" "}
                      Parece que foi salvo um “apelido” ({editionIdHint!.name}). O ID correto provavelmente é{" "}
                      <span className="font-mono">{editionIdHint!.id}</span>. Peça ao admin para atribuir o ID correto.
                    </>
                  ) : null}
                </p>
              ) : null}

              {edition ? (
                <p className="mt-2 text-xs text-zinc-600">
                  ID: <span className="font-mono">{edition.id}</span>
                </p>
              ) : null}

              {edition ? (
                <p className="mt-1 text-xs text-zinc-600">
                  Lotes liberados: {allowedBatches.length ? allowedBatches.join(", ") : "—"}
                </p>
              ) : null}
            </div>

            <Link href="/dashboard" className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-semibold hover:bg-zinc-700">
              Voltar
            </Link>
          </div>
        </div>

        {msg ? <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-200 ring-1 ring-emerald-500/20">{msg}</div> : null}
        {err ? <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/20">{err}</div> : null}

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-600">Cadastro</p>
              <p className="text-base font-semibold">
                {canRegister ? (
                  <span className="text-emerald-200">Liberado</span>
                ) : (
                  <span className="text-red-200">Bloqueado (sorteio iniciado/encerrado)</span>
                )}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                Dica: você pode digitar CPF e telefone para buscar comprador automaticamente.
              </p>
            </div>

            <div className="text-right text-xs text-zinc-600">
              <div>Min dígitos cartela: {minDigits}</div>
              <div>{findingBuyer ? "Buscando comprador…" : buyerFound ? `Comprador: ${buyerFound.name} (CPF ****${buyerFound.cpfLast4})` : "—"}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <h2 className="text-base font-semibold">Comprador</h2>
            <p className="mt-1 text-xs text-zinc-600">Preencha os dados do comprador. CPF deve ser válido.</p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700">Nome</span>
                <input
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className="rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-600"
                  placeholder="Nome completo"
                  disabled={busy}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700">Telefone</span>
                <input
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  className="rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-600"
                  placeholder="DDD + número (ex.: 11999999999)"
                  disabled={busy}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700">CPF</span>
                <input
                  value={buyerCpf}
                  onChange={(e) => setBuyerCpf(e.target.value)}
                  className="rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-600"
                  placeholder="Somente números"
                  disabled={busy}
                />
              </label>

              {buyerFound ? (
                <div className="rounded-xl bg-zinc-900 p-3 text-xs text-zinc-700 ring-1 ring-zinc-200">
                  <div className="font-semibold">Comprador encontrado</div>
                  <div className="mt-1">Nome: {buyerFound.name}</div>
                  <div>Telefone: {buyerFound.phoneE164}</div>
                  <div>CPF: ****{buyerFound.cpfLast4}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <h2 className="text-base font-semibold">Cartelas</h2>
            <p className="mt-1 text-xs text-zinc-600">
              Cole os números das cartelas (separados por espaço/linha/vírgula).
            </p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700">Números</span>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="min-h-[140px] rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-600"
                  placeholder={`Ex.: ${formatPrintedNumber(1, minDigits)} ${formatPrintedNumber(2, minDigits)} ${formatPrintedNumber(3, minDigits)}`}
                  disabled={busy}
                />
              </label>

              <button
                onClick={onRegister}
                disabled={busy || loading || !edition || !canRegister}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Salvando…" : "Cadastrar"}
              </button>
            </div>

            {report ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-200 ring-1 ring-emerald-500/20">
                  <div className="font-semibold">OK ({report.ok.length})</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {report.ok.map((n) => (
                      <span key={n} className="rounded-lg bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/20">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200 ring-1 ring-red-500/20">
                  <div className="font-semibold">Falhas ({report.bad.length})</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {report.bad.map((n, i) => (
                      <li key={`${n}-${i}`}>{n}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <h2 className="text-base font-semibold">Minhas vendas recentes</h2>
          <p className="mt-1 text-xs text-zinc-600">Últimas 20 vendas (ordenadas localmente).</p>

          {salesErr ? <p className="mt-3 text-sm text-red-200">{salesErr}</p> : null}

          {sales === null ? (
            <p className="mt-3 text-sm text-zinc-600">Carregando…</p>
          ) : sales.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">Nenhuma venda encontrada.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {sales.map((s) => (
                <div key={s.id} className="rounded-xl bg-zinc-900 p-3 ring-1 ring-zinc-200">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{s.buyerNameSnapshot}</div>
                      <div className="text-xs text-zinc-600">
                        {s.buyerPhoneSnapshot} • CPF ****{s.buyerCpfLast4Snapshot}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-9000">{createdAtSeconds(s.createdAt) ? new Date(createdAtSeconds(s.createdAt) * 1000).toLocaleString() : ""}</div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {(s.cardPrintedNumbers ?? []).map((n) => (
                      <span key={`${s.id}-${n}`} className="rounded-lg bg-zinc-800 px-2 py-1 text-xs">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SellerGuard>
  );
}
