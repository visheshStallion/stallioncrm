/**
 * Costing (prompt 16 §4, §10). Pure functions: landed-cost allocation and FIFO / weighted-average valuation
 * of quantity-tracked items. All amounts are NGN, rounded to kobo; allocations always add up to the total.
 */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type AllocationMethod = "VALUE" | "QUANTITY" | "WEIGHT" | "MANUAL";
export const ALLOCATION_METHODS: AllocationMethod[] = ["VALUE", "QUANTITY", "WEIGHT", "MANUAL"];

export interface AllocationTarget {
  id: string;
  /** purchase cost (VALUE) */
  value: number;
  /** kerb weight in kg (WEIGHT) */
  weight?: number | null;
  /** fixed amount (MANUAL) */
  manual?: number | null;
}

/**
 * Splits `total` over the targets. The last target absorbs the rounding difference so the shares add up
 * exactly. MANUAL amounts must add up to the total; WEIGHT needs a weight on every target.
 */
export function allocateLandedCost(total: number, targets: AllocationTarget[], method: AllocationMethod): Map<string, number> {
  if (targets.length === 0) throw new Error("Choose at least one vehicle to allocate the charges to");
  if (!(total > 0)) throw new Error("There is nothing to allocate");
  const out = new Map<string, number>();
  if (method === "MANUAL") {
    const sum = round2(targets.reduce((s, t) => s + (t.manual ?? 0), 0));
    if (Math.abs(sum - round2(total)) > 0.005) throw new Error(`The manual amounts add up to ${sum.toFixed(2)}, not ${round2(total).toFixed(2)}`);
    for (const t of targets) out.set(t.id, round2(t.manual ?? 0));
    return out;
  }
  const basis = targets.map((t) => (method === "VALUE" ? t.value : method === "QUANTITY" ? 1 : (t.weight ?? 0)));
  if (method === "WEIGHT" && basis.some((b) => !(b > 0))) throw new Error("Every vehicle needs a weight to allocate by weight");
  const base = basis.reduce((s, b) => s + b, 0);
  if (!(base > 0)) throw new Error("The vehicles have no value to allocate by – use quantity instead");
  let given = 0;
  targets.forEach((t, i) => {
    const share = i === targets.length - 1 ? round2(total - given) : round2((total * basis[i]!) / base);
    given = round2(given + share);
    out.set(t.id, share);
  });
  return out;
}

export interface CostLayer {
  qty: number;
  unitCost: number;
}

/** FIFO issue: consumes the oldest layers first. Returns the cost of the issue and the remaining layers. */
export function fifoIssue(layers: CostLayer[], qty: number): { cost: number; remaining: CostLayer[] } {
  if (!(qty > 0)) throw new Error("Quantity must be positive");
  const available = layers.reduce((s, l) => s + l.qty, 0);
  if (qty > available + 1e-9) throw new Error(`Only ${available} in stock`);
  let left = qty;
  let cost = 0;
  const remaining: CostLayer[] = [];
  for (const l of layers) {
    if (left <= 0) {
      remaining.push({ ...l });
      continue;
    }
    const take = Math.min(l.qty, left);
    cost += take * l.unitCost;
    left -= take;
    if (l.qty - take > 1e-9) remaining.push({ qty: round2(l.qty - take), unitCost: l.unitCost });
  }
  return { cost: round2(cost), remaining };
}

/** Rebuilds the open FIFO layers of an item from its movements in posting order. */
export function fifoLayers(movements: Array<{ qtyIn: number; qtyOut: number; unitCost: number }>): CostLayer[] {
  let layers: CostLayer[] = [];
  for (const m of movements) {
    if (m.qtyIn > 0) layers.push({ qty: m.qtyIn, unitCost: m.unitCost });
    if (m.qtyOut > 0) layers = fifoIssue(layers, Math.min(m.qtyOut, layers.reduce((s, l) => s + l.qty, 0))).remaining;
  }
  return layers;
}

/** Weighted average: the cost of an issue is quantity × (stock value ÷ stock quantity). */
export function weightedAverageIssue(balance: { qty: number; value: number }, qty: number): number {
  if (!(qty > 0)) throw new Error("Quantity must be positive");
  if (qty > balance.qty + 1e-9) throw new Error(`Only ${balance.qty} in stock`);
  // issuing everything takes the whole value, so no rounding remainder stays on an empty balance
  if (Math.abs(qty - balance.qty) < 1e-9) return round2(balance.value);
  return round2((balance.value / balance.qty) * qty);
}
