import type { Tone } from "@/components/crm/primitives";
import type { SlaState } from "@/server/modules/cases/queries";

export const STATUS_TONE: Record<string, Tone> = { NEW: "info", IN_PROGRESS: "primary", WAITING_ON_CUSTOMER: "neutral", ESCALATED: "danger", RESOLVED: "success", CLOSED: "neutral" };
export const SLA_TONE: Record<SlaState, Tone> = { none: "neutral", ok: "success", due_soon: "warning", breached: "danger", met: "success", missed: "danger" };
export const SLA_LABEL: Record<SlaState, string> = { none: "No SLA", ok: "On time", due_soon: "Due soon", breached: "Breached", met: "Met", missed: "Missed" };
