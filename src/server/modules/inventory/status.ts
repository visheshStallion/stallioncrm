/**
 * Vehicle lifecycle (prompt 16 §3). Pure. Every change of `VehicleUnit.status` goes through
 * `assertTransition`; the posting engine writes the history row.
 *
 *   On order → In transit → At port → In clearing → PDI pending → Available → Reserved → Allocated
 *   → Invoiced → Delivered            side states: Demo, On hold, Transferred, Returned, Written off
 */
export const VEHICLE_STATUSES = ["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING", "PDI_PENDING", "AVAILABLE", "RESERVED", "ALLOCATED", "INVOICED", "DELIVERED", "DEMO", "ON_HOLD", "TRANSFERRED", "RETURNED", "WRITTEN_OFF"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  ON_ORDER: "On order",
  IN_TRANSIT: "In transit",
  AT_PORT: "At port",
  IN_CLEARING: "In clearing",
  PDI_PENDING: "In stock – PDI pending",
  AVAILABLE: "In stock – available",
  RESERVED: "Reserved",
  ALLOCATED: "Allocated",
  INVOICED: "Invoiced",
  DELIVERED: "Delivered",
  DEMO: "Demo / test-drive fleet",
  ON_HOLD: "Damaged / on hold",
  TRANSFERRED: "Transferred",
  RETURNED: "Returned",
  WRITTEN_OFF: "Written off",
};

const TRANSITIONS: Record<VehicleStatus, VehicleStatus[]> = {
  ON_ORDER: ["IN_TRANSIT", "AT_PORT", "PDI_PENDING"],
  IN_TRANSIT: ["AT_PORT", "IN_CLEARING", "PDI_PENDING"],
  AT_PORT: ["IN_CLEARING", "PDI_PENDING"],
  IN_CLEARING: ["PDI_PENDING"],
  PDI_PENDING: ["AVAILABLE", "ON_HOLD", "TRANSFERRED", "RETURNED", "WRITTEN_OFF"],
  AVAILABLE: ["RESERVED", "DEMO", "ON_HOLD", "TRANSFERRED", "RETURNED", "WRITTEN_OFF", "PDI_PENDING"],
  RESERVED: ["AVAILABLE", "ALLOCATED"],
  // delivery before invoicing is allowed (the sales order flow of prompt 06): the cost of sale is posted at the gate pass
  ALLOCATED: ["RESERVED", "AVAILABLE", "INVOICED", "DELIVERED"],
  INVOICED: ["DELIVERED", "ALLOCATED"],
  DELIVERED: [],
  DEMO: ["AVAILABLE", "ON_HOLD", "WRITTEN_OFF"],
  ON_HOLD: ["PDI_PENDING", "AVAILABLE", "WRITTEN_OFF", "RETURNED"],
  TRANSFERRED: [],
  RETURNED: [],
  WRITTEN_OFF: [],
};

export const canTransition = (from: VehicleStatus, to: VehicleStatus) => TRANSITIONS[from].includes(to);

export function assertTransition(from: VehicleStatus, to: VehicleStatus): void {
  if (!canTransition(from, to)) throw new Error(`A vehicle cannot go from "${STATUS_LABELS[from]}" to "${STATUS_LABELS[to]}"`);
}

/** Physically in one of the brand's warehouses (counts as stock on hand and ages). */
export const IN_STOCK: VehicleStatus[] = ["PDI_PENDING", "AVAILABLE", "RESERVED", "ALLOCATED", "INVOICED", "DEMO", "ON_HOLD"];
/** On its way: ordered, shipped, at the port or in clearing. */
export const PIPELINE: VehicleStatus[] = ["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING"];
/** What a sales executive may pick for a deal. */
export const SELLABLE: VehicleStatus[] = ["AVAILABLE"];

export const AGEING_BUCKETS = [
  { key: "0-30", label: "0–30 days", max: 30 },
  { key: "31-60", label: "31–60 days", max: 60 },
  { key: "61-90", label: "61–90 days", max: 90 },
  { key: "91-180", label: "91–180 days", max: 180 },
  { key: "180+", label: "180+ days", max: Infinity },
] as const;

export function ageingDays(receivedAt: Date | string | null | undefined, now = new Date()): number | null {
  if (!receivedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 86_400_000));
}

export function ageingBucket(days: number | null): string | null {
  if (days === null) return null;
  return AGEING_BUCKETS.find((b) => days <= b.max)!.key;
}
