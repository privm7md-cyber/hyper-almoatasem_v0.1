// INTERACTIVE PROTOTYPE store — client-side mock state only ("use client").
// No fetch, no backend, no tokens. State resets on reload; reset button provided.

"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CartLine, INITIAL_ORDER, MockOrder, getProduct } from "./mock";

export type Notice = { kind: "ok" | "err"; text: string } | null;

interface ProtoState {
  cart: CartLine[];
  cartCount: number;
  addToCart: (productId: string, qtyText: string) => void;
  setQty: (productId: string, qtyText: string) => void;
  removeLine: (productId: string) => void;
  clearCart: () => void;
  notice: Notice;
  setNotice: (n: Notice) => void;
  pending: boolean;
  runMock: (fn: () => void, ms?: number) => void;
  order: MockOrder;
  decideReplacement: (decision: "CUSTOMER_APPROVED" | "CUSTOMER_REJECTED") => void;
  resetOrder: () => void;
  adminAuthed: boolean;
  adminLogin: (ok: boolean) => void;
  adminLogout: () => void;
  resetAll: () => void;
}

const Ctx = createContext<ProtoState | null>(null);

function cloneOrder(): MockOrder {
  return {
    ...INITIAL_ORDER,
    lines: INITIAL_ORDER.lines.map((l) => ({ ...l })),
    requestedVsActual: INITIAL_ORDER.requestedVsActual.map((r) => ({ ...r })),
    replacement: INITIAL_ORDER.replacement ? { ...INITIAL_ORDER.replacement } : null,
  };
}

export function ProtoProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([{ productId: "p-rice", qtyText: "1" }]);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [order, setOrder] = useState<MockOrder>(cloneOrder);
  const [adminAuthed, setAdminAuthed] = useState(false);

  const runMock = useCallback((fn: () => void, ms = 700) => {
    setPending(true);
    setNotice(null);
    window.setTimeout(() => {
      setPending(false);
      fn();
    }, ms);
  }, []);

  const addToCart = useCallback((productId: string, qtyText: string) => {
    setCart((prev) => {
      const found = prev.find((l) => l.productId === productId);
      if (found) return prev.map((l) => (l.productId === productId ? { ...l, qtyText } : l));
      return [...prev, { productId, qtyText }];
    });
    const p = getProduct(productId);
    setNotice({ kind: "ok", text: `تمت الإضافة إلى السلة (محاكاة): ${p ? p.name : productId}` });
  }, []);

  const setQty = useCallback((productId: string, qtyText: string) => {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, qtyText } : l)));
  }, []);

  const removeLine = useCallback((productId: string) => {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const decideReplacement = useCallback((decision: "CUSTOMER_APPROVED" | "CUSTOMER_REJECTED") => {
    setOrder((prev) => {
      if (!prev.replacement || prev.replacement.status !== "PROPOSED") return prev;
      return { ...prev, replacement: { ...prev.replacement, status: decision } };
    });
    setNotice({
      kind: "ok",
      text:
        decision === "CUSTOMER_APPROVED"
          ? "تم قبول البديل (محاكاة)."
          : "تم رفض البديل (محاكاة) — سيظل السطر ناقصًا.",
    });
  }, []);

  const resetOrder = useCallback(() => setOrder(cloneOrder()), []);

  const adminLogin = useCallback((ok: boolean) => {
    if (ok) {
      setAdminAuthed(true);
      setNotice({ kind: "ok", text: "تم الدخول التجريبي (محاكاة)." });
    } else {
      setNotice({ kind: "err", text: "بيانات غير صحيحة (محاكاة) — حاول مرة أخرى." });
    }
  }, []);

  const adminLogout = useCallback(() => setAdminAuthed(false), []);

  const resetAll = useCallback(() => {
    setCart([]);
    setOrder(cloneOrder());
    setAdminAuthed(false);
    setNotice(null);
  }, []);

  const value = useMemo<ProtoState>(
    () => ({
      cart,
      cartCount: cart.length,
      addToCart,
      setQty,
      removeLine,
      clearCart,
      notice,
      setNotice,
      pending,
      runMock,
      order,
      decideReplacement,
      resetOrder,
      adminAuthed,
      adminLogin,
      adminLogout,
      resetAll,
    }),
    [
      cart,
      addToCart,
      setQty,
      removeLine,
      clearCart,
      notice,
      pending,
      runMock,
      order,
      decideReplacement,
      resetOrder,
      adminAuthed,
      adminLogin,
      adminLogout,
      resetAll,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProto(): ProtoState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProto outside ProtoProvider (prototype wiring bug)");
  return v;
}
