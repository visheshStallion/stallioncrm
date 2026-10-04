/**
 * Business events (prompt 13). `scopedDb` reports single creates / updates of the event models here;
 * `deriveEvents` turns them into named events, `dispatchEvent` fans each one out to
 *   • the outbox (`DomainEvent`, for traceability),
 *   • every matching webhook subscription (one delivery job each),
 *   • the integrations (ERP posting of confirmed orders and issued invoices).
 * Nothing here ever throws into the user's action: integrations must not break a save.
 */
import "server-only";
import { activeSubscriptionsFor, insertDelivery, recordBrand, type EventEntity } from "@/server/db/api-store";
import { enqueueJob } from "@/server/db/jobs";
import { storeDomainEvent } from "@/server/db/system";
import { logger } from "@/server/log";

export const EVENTS = ["lead.created", "deal.created", "deal.stage_changed", "quote.approved", "salesorder.confirmed", "invoice.issued", "invoice.paid", "case.created", "case.resolved"] as const;
export type EventName = (typeof EVENTS)[number];
export const EVENT_MODELS = new Set<string>(["Lead", "Deal", "Quote", "SalesOrder", "Invoice", "Case"]);
export const EVENT_ENTITY: Record<EventName, EventEntity> = {
  "lead.created": "Lead",
  "deal.created": "Deal",
  "deal.stage_changed": "Deal",
  "quote.approved": "Quote",
  "salesorder.confirmed": "SalesOrder",
  "invoice.issued": "Invoice",
  "invoice.paid": "Invoice",
  "case.created": "Case",
  "case.resolved": "Case",
};

type Row = Record<string, unknown> | null | undefined;
const value = (v: unknown) => (typeof v === "object" && v !== null && "set" in v ? (v as { set: unknown }).set : v);

/** Pure: the events a write stands for. `data` is the Prisma `data` argument, `before` the row before an update. */
export function deriveEvents(model: string, op: "create" | "update", before: Row, data: Record<string, unknown>): EventName[] {
  if (op === "create") {
    if (model === "Lead") return ["lead.created"];
    if (model === "Deal") return ["deal.created"];
    if (model === "Case") return ["case.created"];
    return [];
  }
  const became = (field: string, to: string) => value(data[field]) === to && before?.[field] !== to;
  if (model === "Deal" && data.stageId !== undefined && value(data.stageId) !== before?.stageId) return ["deal.stage_changed"];
  if (model === "Quote" && became("status", "APPROVED")) return ["quote.approved"];
  if (model === "SalesOrder" && became("status", "CONFIRMED")) return ["salesorder.confirmed"];
  if (model === "Invoice" && became("status", "ISSUED")) return ["invoice.issued"];
  if (model === "Invoice" && became("status", "PAID")) return ["invoice.paid"];
  if (model === "Case" && became("status", "RESOLVED")) return ["case.resolved"];
  return [];
}

/** Called by scopedDb after a single create / update of an event model. Never throws. */
export async function onRecordEvent(model: string, op: "create" | "update", before: Row, result: unknown, data: Record<string, unknown>): Promise<void> {
  try {
    const events = deriveEvents(model, op, before, data);
    if (events.length === 0) return;
    const id = (result as { id?: string } | null)?.id ?? (before?.id as string | undefined);
    const brandId = (before?.brandId as string | undefined) ?? (data.brandId as string | undefined) ?? (result as { brandId?: string } | null)?.brandId;
    if (!id) return;
    for (const e of events) await dispatchEvent(e, id, brandId);
  } catch (err) {
    logger.error({ err, model, op }, "event dispatch failed");
  }
}

/** Fans an event out. `brandId` is looked up when the caller does not know it. Never throws. */
export async function dispatchEvent(event: EventName, entityId: string, brandId?: string | null): Promise<void> {
  try {
    const entity = EVENT_ENTITY[event];
    const brand = brandId ?? (await recordBrand(entity, entityId));
    if (!brand) return;
    await storeDomainEvent(event, brand, { entity, entityId });
    let queued = 0;
    for (const sub of await activeSubscriptionsFor(event)) {
      if (sub.brandIds.length && !sub.brandIds.includes(brand)) continue;
      const delivery = await insertDelivery({ subscriptionId: sub.id, event, entity, entityId, brandId: brand });
      await enqueueJob({ type: "webhook.deliver", payload: { deliveryId: delivery.id }, brandId: brand, maxAttempts: 6 });
      queued++;
    }
    if (event === "salesorder.confirmed" || event === "invoice.issued") {
      const { erpEnabledFor } = await import("./erp");
      if (await erpEnabledFor(brand)) {
        // idempotent: a document is posted to the ERP once
        if (await enqueueJob({ type: "erp.post", payload: { entity, entityId, brandId: brand }, brandId: brand, idempotencyKey: `erp:${entity}:${entityId}`, maxAttempts: 6 })) queued++;
      }
    }
    if (queued) (await import("@/server/modules/workflow/engine")).kickJobs();
  } catch (err) {
    logger.error({ err, event, entityId }, "event dispatch failed");
  }
}
