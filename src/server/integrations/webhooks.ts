/**
 * Outbound webhooks (prompt 13): subscriptions per event with an optional brand filter, HMAC-signed payloads,
 * retries with exponential back-off (job queue) and a delivery log.
 *
 * The payload is built with the access context of the subscription's PRINCIPAL – the same queries and field
 * masks as `GET /api/v1/...` – so a subscriber never receives a record or a field its principal may not see.
 * A record the principal cannot see is skipped (logged as SKIPPED), not delivered empty.
 */
import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { Job } from "@prisma/client";
import { z } from "zod";
import { loadAccessContext } from "@/server/access/context";
import { isAccessError, NotFoundError } from "@/server/access/errors";
import { fieldMask } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import * as store from "@/server/db/api-store";
import { enqueueJob } from "@/server/db/jobs";
import { BadRequestError } from "@/server/errors";
import { restrictToBrands } from "@/server/modules/api/tokens";
import { EVENTS, type EventName } from "./events";

const TIMEOUT_MS = 10_000;

/** `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">` – verify with the subscription's secret. */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** https and a public address only (SSRF guard). Outside production, WEBHOOK_ALLOW_PRIVATE=1 permits local test receivers. */
async function assertWebhookUrl(raw: string): Promise<URL> {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "1" && process.env.NODE_ENV !== "production") return new URL(raw);
  return (await import("@/server/modules/workflow/engine")).assertPublicUrl(raw);
}

/** The record as the principal sees it through the API; null when it is hidden from the principal. */
export async function eventPayload(ctx: AccessContext, entity: string, id: string): Promise<unknown | null> {
  try {
    switch (entity) {
      case "Lead":
        return await (await import("@/server/modules/leads/queries")).getLead(ctx, id); // masked by the query
      case "Deal":
        return fieldMask(ctx, "deals", await (await import("@/server/modules/deals/queries")).getDeal(ctx, id));
      case "Case":
        return fieldMask(ctx, "cases", await (await import("@/server/modules/cases/queries")).getCase(ctx, id));
      case "Quote":
      case "SalesOrder":
      case "Invoice": {
        const type = entity === "Quote" ? "quote" : entity === "SalesOrder" ? "salesOrder" : "invoice";
        return fieldMask(ctx, entity === "Quote" ? "quotes" : entity === "SalesOrder" ? "salesOrders" : "invoices", await (await import("@/server/modules/documents/queries")).getDocument(ctx, type, id));
      }
      case "VehicleUnit":
        return await (await import("@/server/modules/inventory/queries")).getUnit(ctx, id);
      case "JournalEntry":
        return await (await import("@/server/modules/inventory/queries")).getJournal(ctx, id);
      case "Product": {
        const rows = await (await import("@/server/modules/inventory/queries")).listStockBalances(ctx, { reorderOnly: true });
        const mine = rows.filter((r) => r.productId === id);
        return mine.length ? { productId: id, code: mine[0]!.code, name: mine[0]!.name, reorderLevel: mine[0]!.reorderLevel, onHand: mine.reduce((s, r) => s + r.qty, 0) } : null;
      }
      default:
        return null;
    }
  } catch (err) {
    if (isAccessError(err)) return null; // 403 / 404 for the principal
    throw err;
  }
}

/** Job handler "webhook.deliver". Throws on a failed attempt so the queue retries with back-off. */
export async function deliverWebhook(job: Pick<Job, "payload" | "attempts">): Promise<Record<string, unknown>> {
  const { deliveryId } = job.payload as { deliveryId: string };
  const delivery = (await store.listDeliveriesById([deliveryId]))[0];
  if (!delivery) return { skipped: "delivery removed" };
  const skip = async (reason: string) => {
    await store.updateDelivery(deliveryId, { status: "SKIPPED", error: reason, attempts: job.attempts });
    return { skipped: reason };
  };
  const sub = await store.getSubscription(delivery.subscriptionId);
  if (!sub?.active) return skip("subscription inactive");
  const principal = await loadAccessContext(sub.userId);
  if (!principal) return skip("principal inactive");
  const ctx = restrictToBrands(principal, sub.brandIds);
  const data = await eventPayload(ctx, delivery.entity, delivery.entityId);
  if (data === null) return skip("record not visible to the subscription's principal");

  const body = JSON.stringify({ id: delivery.id, event: delivery.event, createdAt: delivery.createdAt.toISOString(), brandId: delivery.brandId, entity: delivery.entity, data });
  try {
    const url = await assertWebhookUrl(sub.url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "StallionCRM-Webhooks/1", "X-Stallion-Event": delivery.event, "X-Stallion-Delivery": delivery.id, "X-Stallion-Signature": signPayload(sub.secret, body) },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      await store.updateDelivery(deliveryId, { status: "FAILED", attempts: job.attempts, responseStatus: res.status, error: `HTTP ${res.status}` });
      throw new Error(`Webhook ${sub.name}: HTTP ${res.status}`);
    }
    await store.updateDelivery(deliveryId, { status: "DELIVERED", attempts: job.attempts, responseStatus: res.status, error: null, deliveredAt: new Date() });
    return { delivered: res.status };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    if (!message.startsWith("Webhook ")) await store.updateDelivery(deliveryId, { status: "FAILED", attempts: job.attempts, error: message });
    throw err;
  }
}

// ───────────────────────────── administration ─────────────────────────────

function assertAdmin(ctx: AccessContext) {
  if (!ctx.isAdmin || ctx.tokenId) throw new NotFoundError();
}

const subscriptionInput = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(EVENTS)).min(1, "Choose at least one event"),
  brandIds: z.array(z.string().max(40)).max(20).default([]),
  /** the principal whose access decides what the payload contains */
  userId: z.string().min(1, "Choose the principal"),
  active: z.boolean().default(true),
});

export async function saveSubscription(ctx: AccessContext, id: string | null, input: unknown) {
  assertAdmin(ctx);
  const data = subscriptionInput.parse(input);
  await assertWebhookUrl(data.url).catch((e) => {
    throw new BadRequestError(e instanceof Error ? e.message : "Invalid webhook URL");
  });
  const principal = await loadAccessContext(data.userId);
  if (!principal) throw new BadRequestError("The principal is not an active user");
  if (data.brandIds.some((b) => !principal.brandIds.includes(b))) throw new BadRequestError("The brand filter contains a brand the principal cannot see");
  if (id && !(await store.getSubscription(id))) throw new NotFoundError();
  const secret = id ? undefined : `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await store.saveSubscription(id, { ...data, createdById: ctx.userId }, secret);
  await audit({ ctx, action: id ? "UPDATE" : "CREATE", entity: "WebhookSubscription", entityId: row.id, after: { ...data } });
  /** the signing secret is returned once, on creation */
  return { id: row.id, secret };
}

export async function listSubscriptions(ctx: AccessContext) {
  assertAdmin(ctx);
  return (await store.listSubscriptions()).map(({ secret: _secret, ...s }) => s);
}

export async function deleteSubscription(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  const sub = await store.getSubscription(id);
  if (!sub) throw new NotFoundError();
  await store.deleteSubscription(id);
  await audit({ ctx, action: "DELETE", entity: "WebhookSubscription", entityId: id, before: { name: sub.name, url: sub.url } });
}

export async function listDeliveries(ctx: AccessContext, subscriptionId?: string) {
  assertAdmin(ctx);
  return store.listDeliveries(subscriptionId);
}

/** Queues a failed / skipped delivery again. */
export async function redeliver(ctx: AccessContext, deliveryId: string) {
  assertAdmin(ctx);
  const delivery = (await store.listDeliveriesById([deliveryId]))[0];
  if (!delivery) throw new NotFoundError();
  await store.updateDelivery(deliveryId, { status: "PENDING", error: null });
  await enqueueJob({ type: "webhook.deliver", payload: { deliveryId }, brandId: delivery.brandId, maxAttempts: 3 });
  (await import("@/server/modules/workflow/engine")).kickJobs();
}

export type { EventName };
