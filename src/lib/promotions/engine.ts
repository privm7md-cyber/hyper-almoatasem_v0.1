// BA-8 promotion engine (pure, no DB, no server-only).
//
// Exact integer port of the frozen Phase 4 evaluation (db/tests/
// run-phase4-tests.js evaluate/evaluateOrder/allocate), with two
// documented architecture-faithful resolutions:
//  - Order-level allocation runs ONCE (the harness double applies the
//    second identical loop over already-reduced nets; rows/totals are
//    unaffected there, but coupon bases would double-shrink — the
//    architecture (§23 sequential, §32 pro-rata) applies each layer once).
//  - Final created_at tiebreak falls back to id ASC (frozen gives
//    created_at ASC; same-tx ties need determinism).
// Money = integer piastres, quantities = integer thousandths (WEIGHT) or
// packs-thousandths (PIECE). divRoundHalfAway is exact long division —
// no floating point anywhere (matches PG round half-away).

/** Exact N/D rounded half away from zero (all inputs non-negative here). */
export function divRoundHalfAway(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  return r * 2 >= d ? q + 1 : q;
}

/** Decimal text (≤dp places) -> integer scaled value. "12.50" (dp 2) -> 1250. */
export function parseScaled(s: string, dp: number): number {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = (fracRaw + "0".repeat(dp)).slice(0, dp);
  const value = Number(intPart) * 10 ** dp + Number(frac);
  return neg ? -value : value;
}

export const SPEC_RANK: Record<string, number> = {
  VARIANT: 4,
  PRODUCT: 3,
  BRAND: 2,
  CATEGORY: 1,
};

export interface LineCtx {
  vid: string;
  pid: string;
  bid: string | null;
  cid: string;
  pt: "PIECE" | "WEIGHT";
  /** Counting unit: 'PIECE' for PIECE lines, size_unit for WEIGHT. */
  pu: string;
  su: string | null;
}

export interface EvalLine {
  key: string;
  ctx: LineCtx;
  /** Integer thousandths of the counting unit. */
  qtyT: number;
  /** Integer piastres, exact gross. */
  grossC: number;
  /** Running net, integer piastres (mutated by evaluation). */
  netC: number;
  /** Integer piastres per 1 sale unit (live variant price). */
  unitPriceC: number;
}

export interface PromoTarget {
  tt: "VARIANT" | "PRODUCT" | "BRAND" | "CATEGORY";
  tid: string;
}

export interface EvalPromo {
  id: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT" | "BUY_X_GET_Y" | "FIXED_PRICE";
  scope: "LINE" | "ORDER";
  priority: number;
  isStackable: boolean;
  createdAt: string;
  targets: PromoTarget[];
  discountPercentH: number | null;
  discountAmountC: number | null;
  fixedPriceC: number | null;
  minimumQuantityT: number | null;
  minimumAmountC: number | null;
  maximumDiscountC: number | null;
  buyQtyT: number | null;
  getQtyT: number | null;
  buyPctH: number | null;
  freeVariantId: string | null;
  usageLimit: number | null;
  /** Category subtree probe injected by the caller (DB-owned tree). */
  inSubtree: (lineCid: string, targetCid: string) => boolean;
}

/** Best specificity hit for one line (0 = no match; OR across targets). */
export function matchLine(ctx: LineCtx, promo: EvalPromo): number {
  let best = 0;
  for (const tg of promo.targets) {
    let hit = false;
    if (tg.tt === "VARIANT" && tg.tid === ctx.vid) hit = true;
    if (tg.tt === "PRODUCT" && tg.tid === ctx.pid) hit = true;
    if (tg.tt === "BRAND" && ctx.bid !== null && tg.tid === ctx.bid) hit = true;
    if (tg.tt === "CATEGORY" && promo.inSubtree(ctx.cid, tg.tid)) hit = true;
    if (hit) best = Math.max(best, SPEC_RANK[tg.tt] ?? 0);
  }
  return best;
}

/** WEIGHT line quantity in milligrams (KG thousandths ARE grams);
 * PIECE lines stay in pack-thousandths. Minimum quantities for WEIGHT
 * are gram-denominated per the frozen rule (mg = grams × 1000). */
function weightMg(ctx: LineCtx, qtyT: number): number {
  return ctx.pu === "KG" || ctx.su === "KG" ? qtyT * 1000 : qtyT;
}

export interface LineApp {
  promo: EvalPromo;
  itemIdx: number;
  /** Estimate-basis base (running net at application), piastres. */
  baseC: number;
  /** Granted discount, piastres. */
  amountC: number;
  spec: number;
  /** Same-variant BXGY free quantity, thousandths (0 otherwise). */
  freeQtyT: number;
  /** Cross-variant free spec (caller materializes the free line). */
  freeLine: { variantId: string; qtyT: number } | null;
}

/**
 * LINE-scope layer: thresholds over ALL eligible lines, then per-line
 * candidates in priority DESC → specificity DESC → created ASC (+ id),
 * stacking gate (first wins unless incoming stackable AND all accepted
 * stackable), sequential compounding on running nets.
 */
export function evaluateLines(lines: EvalLine[], promos: EvalPromo[]): { rows: LineApp[] } {
  const out: LineApp[] = [];
  const live = promos.filter((p) => p.scope === "LINE");
  const ok = new Map<string, boolean>();
  const capLeft = new Map<string, number>();
  for (const p of live) {
    let sumQ = 0;
    let sumG = 0;
    let elig = 0;
    for (const l of lines) {
      if (!matchLine(l.ctx, p)) continue;
      elig++;
      sumQ += l.ctx.pt === "WEIGHT" ? weightMg(l.ctx, l.qtyT) : l.qtyT;
      sumG += l.grossC;
    }
    ok.set(
      p.id,
      elig > 0 &&
        (p.minimumQuantityT === null || sumQ >= minQtyThousandths(p, lines)) &&
        (p.minimumAmountC === null || sumG >= p.minimumAmountC),
    );
    capLeft.set(p.id, p.maximumDiscountC === null ? Number.POSITIVE_INFINITY : p.maximumDiscountC);
  }
  const accepted: Array<Array<{ id: string; stackable: boolean }>> = lines.map(() => []);
  const cands = lines.map((l) => {
    const arr: Array<{ p: EvalPromo; spec: number }> = [];
    for (const p of live) {
      const spec = matchLine(l.ctx, p);
      if (spec > 0) arr.push({ p, spec });
    }
    arr.sort(
      (a, b) =>
        b.p.priority - a.p.priority ||
        b.spec - a.spec ||
        (a.p.createdAt < b.p.createdAt ? -1 : a.p.createdAt > b.p.createdAt ? 1 : a.p.id < b.p.id ? -1 : 1),
    );
    return arr;
  });
  // Deterministic cap accumulation: line-key order × per-line candidate order.
  const idx = lines.map((_, i) => i).sort((a, b) => (lines[a].key < lines[b].key ? -1 : 1));
  for (const i of idx) {
    for (const { p, spec } of cands[i]) {
      if (!ok.get(p.id)) continue;
      const acc = accepted[i];
      if (!(acc.length === 0 || (p.isStackable && acc.every((a) => a.stackable)))) continue;
      const base = lines[i].netC;
      let amt = 0;
      let freeQtyT = 0;
      const freeLine: LineApp["freeLine"] = null;
      if (p.type === "PERCENTAGE") {
        amt = divRoundHalfAway(base * (p.discountPercentH as number), 10000);
      } else if (p.type === "FIXED_AMOUNT") {
        amt = Math.min(p.discountAmountC as number, base);
      } else if (p.type === "FIXED_PRICE") {
        const perUnit = Math.max(0, lines[i].unitPriceC - (p.fixedPriceC as number));
        amt = divRoundHalfAway(perUnit * lines[i].qtyT, 1000);
        if (amt <= 0) continue;
      } else {
        // BUY_X_GET_Y: sets = floor(bought / buy); remainder earns nothing.
        const sets = Math.floor(lines[i].qtyT / (p.buyQtyT as number));
        if (sets <= 0) continue;
        freeQtyT = sets * (p.getQtyT as number);
        if (p.freeVariantId) {
          out.push({ promo: p, itemIdx: i, baseC: base, amountC: 0, spec, freeQtyT, freeLine: { variantId: p.freeVariantId, qtyT: freeQtyT } });
          continue;
        }
        const pctH = p.buyPctH as number;
        const freeGrossC = divRoundHalfAway(freeQtyT * lines[i].unitPriceC, 1000);
        amt = Math.min(divRoundHalfAway(freeGrossC * pctH, 10000), base);
      }
      const room = (capLeft.get(p.id) as number) - 0;
      if (!(room > 0)) continue;
      if (amt > room) amt = room;
      if (amt <= 0) continue;
      capLeft.set(p.id, (capLeft.get(p.id) as number) - amt);
      lines[i].netC = base - amt;
      acc.push({ id: p.id, stackable: p.isStackable });
      out.push({ promo: p, itemIdx: i, baseC: base, amountC: amt, spec, freeQtyT, freeLine });
    }
  }
  return { rows: out };
}

/** Minimum-quantity threshold in the accumulated unit (WEIGHT→mg when any
 * eligible line is weight, else pack-thousandths). Frozen rule shapes:
 * minimum_quantity is gram-denominated for weight lines. */
function minQtyThousandths(p: EvalPromo, lines: EvalLine[]): number {
  const anyWeight = lines.some((l) => l.ctx.pt === "WEIGHT" && matchLine(l.ctx, p) > 0);
  return (p.minimumQuantityT as number) * (anyWeight ? 1000 : 1);
}

export interface OrderApp {
  promo: EvalPromo;
  baseC: number;
  amountC: number;
  /** Eligible line indexes (allocation over running nets by the caller). */
  elig: number[];
  /** Per-app net snapshot (pre-reduction) for persistence-time allocation. */
  snapKeys: string[];
  snapNets: number[];
}

/**
 * ORDER-scope layer (pure, sequential): priority DESC → created ASC (+ id);
 * minimum on merchandise GROSS pre-discount; base = Σ eligible running
 * nets; each app reduces nets before the next (frozen layering); no
 * stacking gate at this layer (frozen); cap applied. Snapshots feed
 * persistence-time allocation under real ids.
 */
export function evaluateOrderLayer(lines: EvalLine[], promos: EvalPromo[]): { rows: OrderApp[]; grossAllC: number } {
  const out: OrderApp[] = [];
  const grossAllC = lines.reduce((s, l) => s + l.grossC, 0);
  const oautos = promos
    .filter((p) => p.scope === "ORDER")
    .sort((a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  for (const p of oautos) {
    const elig = lines.map((_, i) => i).filter((i) => p.targets.length === 0 || matchLine(lines[i].ctx, p) > 0);
    // Frozen minimum_amount semantics (phase4-schema: eligible-lines GROSS
    // pre-discount — NOT cart-wide gross): targeted ORDER promos qualify on
    // eligible lines only. Targetless promos see all lines (identical).
    const eligGrossC = elig.reduce((s, i) => s + lines[i].grossC, 0);
    if (p.minimumAmountC !== null && eligGrossC < p.minimumAmountC) continue;
    const base = elig.reduce((s, i) => s + lines[i].netC, 0);
    if (base <= 0) continue;
    let amt =
      p.type === "PERCENTAGE"
        ? divRoundHalfAway(base * (p.discountPercentH as number), 10000)
        : Math.min(p.discountAmountC as number, base);
    if (p.maximumDiscountC !== null) amt = Math.min(amt, p.maximumDiscountC);
    if (amt <= 0) continue;
    const snapKeys = elig.map((i) => lines[i].key);
    const snapNets = elig.map((i) => lines[i].netC);
    const shares = allocate(
      amt,
      elig.map((i) => ({ id: lines[i].key, netC: lines[i].netC })),
    );
    for (const s of shares) {
      const li = lines.find((l) => l.key === s.id);
      if (li) li.netC -= s.amountC;
    }
    out.push({ promo: p, baseC: base, amountC: amt, elig, snapKeys, snapNets });
  }
  return { rows: out, grossAllC };
}

/**
 * Deterministic pro-rata allocation with largest remainder (dust ordered
 * by fractional remainder DESC, ties by id ASC). Sums EXACTLY to total.
 */
export function allocate(totalC: number, items: Array<{ id: string; netC: number }>): Array<{ id: string; amountC: number }> {
  const base = items.reduce((s, x) => s + x.netC, 0);
  if (base <= 0 || totalC <= 0) return items.map((x) => ({ id: x.id, amountC: 0 }));
  const work = items.map((x) => {
    const num = totalC * x.netC;
    const fl = Math.floor(num / base);
    return { id: x.id, amountC: fl, rem: num - fl * base };
  });
  const dust = totalC - work.reduce((s, x) => s + x.amountC, 0);
  const order = [...work].sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
  for (let k = 0; k < dust; k++) order[k % order.length].amountC += 1;
  return work.map((x) => ({ id: x.id, amountC: x.amountC }));
}
