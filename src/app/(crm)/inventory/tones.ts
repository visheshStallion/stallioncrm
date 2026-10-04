import type { Tone } from "@/components/crm/primitives";
import type { VehicleStatus } from "@/server/modules/inventory/status";

export const STATUS_TONE: Record<VehicleStatus, Tone> = { ON_ORDER: "neutral", IN_TRANSIT: "info", AT_PORT: "info", IN_CLEARING: "info", PDI_PENDING: "warning", AVAILABLE: "success", RESERVED: "warning", ALLOCATED: "primary", INVOICED: "primary", DELIVERED: "neutral", DEMO: "info", ON_HOLD: "danger", TRANSFERRED: "neutral", RETURNED: "neutral", WRITTEN_OFF: "danger" };

/** Tone of an inventory document status. */
export function docTone(status: string): Tone {
  if (["RECEIVED", "PAID", "ALLOCATED", "ADJUSTED", "PASSED", "DELIVERED", "RECONCILED", "APPLIED", "CLOSED"].includes(status)) return "success";
  if (["PENDING_APPROVAL", "PARTIALLY_RECEIVED", "PARTIALLY_PAID", "COUNTING", "PENDING"].includes(status)) return "warning";
  if (["CANCELLED", "VOID", "FAILED"].includes(status)) return "danger";
  if (["DRAFT", "PLANNED", "ORDERED"].includes(status)) return "neutral";
  return "info";
}
