/**
 * System tables of prompt 13: API tokens, OAuth clients, idempotency keys, webhook subscriptions / deliveries,
 * external references and payment links. User sessions have no access to these tables (REVOKE ALL), so every
 * read and write goes through the narrow functions below; the callers in src/server/modules/api and
 * src/server/integrations decide WHO may call them (token owner / administrator).
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

// ───────────────────────────── tokens ─────────────────────────────

export function findTokenByHash(tokenHash: string) {
  return unsafeDb.apiToken.findUnique({ where: { tokenHash } });
}

export async function touchToken(id: string, now = new Date()): Promise<void> {
  // at most one write per minute per token
  await unsafeDb.apiToken.updateMany({ where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }] }, data: { lastUsedAt: now } });
}

export function insertToken(data: Prisma.ApiTokenUncheckedCreateInput) {
  return unsafeDb.apiToken.create({ data });
}

const TOKEN_LIST = { id: true, name: true, kind: true, prefix: true, userId: true, brandIds: true, rateLimit: true, clientId: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;

/** Tokens of one user, or (userId undefined) every long-lived token – administrators. OAuth access tokens are left out. */
export function listTokens(userId?: string) {
  return unsafeDb.apiToken.findMany({ where: { ...(userId ? { userId } : {}), kind: { not: "OAUTH" } }, select: TOKEN_LIST, orderBy: { createdAt: "desc" }, take: 500 });
}

export function getToken(id: string) {
  return unsafeDb.apiToken.findUnique({ where: { id }, select: TOKEN_LIST });
}

export async function revokeToken(id: string): Promise<void> {
  await unsafeDb.apiToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Removes expired OAuth access tokens and old idempotency keys (scheduler). */
export async function purgeApiLeftovers(now = new Date()): Promise<number> {
  const tokens = await unsafeDb.apiToken.deleteMany({ where: { kind: "OAUTH", expiresAt: { lt: new Date(now.getTime() - 3_600_000) } } });
  const keys = await unsafeDb.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
  await unsafeDb.domainEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  return tokens.count + keys.count;
}

// ───────────────────────────── integration principals & OAuth clients ─────────────────────────────

export function listPrincipals() {
  return unsafeDb.user.findMany({
    where: { isIntegration: true },
    select: { id: true, name: true, email: true, active: true, profile: { select: { name: true, scope: true } }, memberships: { select: { territory: { select: { name: true, brandId: true } } } } },
    orderBy: { name: "asc" },
  });
}

export async function markIntegration(userId: string): Promise<void> {
  await unsafeDb.user.update({ where: { id: userId }, data: { isIntegration: true, passwordHash: null } });
}

export function userKind(userId: string) {
  return unsafeDb.user.findUnique({ where: { id: userId }, select: { id: true, name: true, active: true, isIntegration: true } });
}

export function brandLevelTerritories(brandIds: string[]) {
  return unsafeDb.territory.findMany({ where: { brandId: { in: brandIds }, regionId: null }, select: { id: true, brandId: true } });
}

export function insertClient(data: Prisma.OAuthClientUncheckedCreateInput) {
  return unsafeDb.oAuthClient.create({ data });
}

export function listClients() {
  return unsafeDb.oAuthClient.findMany({ select: { id: true, name: true, clientId: true, userId: true, brandIds: true, rateLimit: true, active: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export function findClient(clientId: string) {
  return unsafeDb.oAuthClient.findUnique({ where: { clientId } });
}

export async function setClientActive(id: string, active: boolean) {
  const client = await unsafeDb.oAuthClient.update({ where: { id }, data: { active } });
  if (!active) await unsafeDb.apiToken.updateMany({ where: { clientId: client.clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  return client;
}

// ───────────────────────────── idempotency ─────────────────────────────

export function findIdempotent(scope: string, key: string) {
  return unsafeDb.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
}

export async function storeIdempotent(scope: string, key: string, requestHash: string, status: number, body: unknown): Promise<void> {
  await unsafeDb.idempotencyKey.createMany({ data: [{ scope, key, requestHash, status, body: JSON.parse(JSON.stringify(body ?? null)) ?? {} }], skipDuplicates: true });
}

// ───────────────────────────── webhooks ─────────────────────────────

export function listSubscriptions() {
  return unsafeDb.webhookSubscription.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { deliveries: true } } } });
}

export function activeSubscriptionsFor(event: string) {
  return unsafeDb.webhookSubscription.findMany({ where: { active: true, events: { has: event } } });
}

export function getSubscription(id: string) {
  return unsafeDb.webhookSubscription.findUnique({ where: { id } });
}

export function saveSubscription(id: string | null, data: Omit<Prisma.WebhookSubscriptionUncheckedCreateInput, "id" | "secret">, secret?: string) {
  if (id) return unsafeDb.webhookSubscription.update({ where: { id }, data });
  return unsafeDb.webhookSubscription.create({ data: { ...data, secret: secret ?? "" } });
}

export async function deleteSubscription(id: string): Promise<void> {
  await unsafeDb.webhookSubscription.deleteMany({ where: { id } });
}

export function insertDelivery(data: Prisma.WebhookDeliveryUncheckedCreateInput) {
  return unsafeDb.webhookDelivery.create({ data, select: { id: true } });
}

export async function updateDelivery(id: string, data: Prisma.WebhookDeliveryUncheckedUpdateInput): Promise<void> {
  await unsafeDb.webhookDelivery.updateMany({ where: { id }, data });
}

export function listDeliveries(subscriptionId?: string, take = 100) {
  return unsafeDb.webhookDelivery.findMany({ where: subscriptionId ? { subscriptionId } : {}, orderBy: { createdAt: "desc" }, take, include: { subscription: { select: { name: true } } } });
}

// ───────────────────────────── external references ─────────────────────────────

export function findExternalRef(system: string, entity: string, entityId: string) {
  return unsafeDb.externalRef.findUnique({ where: { system_entity_entityId: { system, entity, entityId } } });
}

export function findExternalRefByExternalId(system: string, externalId: string) {
  return unsafeDb.externalRef.findFirst({ where: { system, externalId } });
}

export function externalRefsOf(entity: string, entityId: string) {
  return unsafeDb.externalRef.findMany({ where: { entity, entityId }, orderBy: { createdAt: "asc" } });
}

export function upsertExternalRef(data: Prisma.ExternalRefUncheckedCreateInput) {
  const { system, entity, entityId } = data;
  return unsafeDb.externalRef.upsert({ where: { system_entity_entityId: { system, entity, entityId } }, create: data, update: { externalId: data.externalId, status: data.status, data: data.data, companyCode: data.companyCode } });
}

// ───────────────────────────── payment links ─────────────────────────────

export function insertPaymentLink(data: Prisma.PaymentLinkUncheckedCreateInput) {
  return unsafeDb.paymentLink.create({ data });
}

export function findPaymentLink(reference: string) {
  return unsafeDb.paymentLink.findUnique({ where: { reference } });
}

export function paymentLinksOf(invoiceId: string) {
  return unsafeDb.paymentLink.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 20 });
}

/** Marks the link paid exactly once; false when it was already settled (duplicate provider webhook). */
export async function settlePaymentLink(reference: string, status: "PAID" | "FAILED"): Promise<boolean> {
  const res = await unsafeDb.paymentLink.updateMany({ where: { reference, status: "PENDING" }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
  return res.count === 1;
}

/** Brand code + ERP company of a brand, for adapters running without a user context. */
export function brandForIntegration(brandId: string) {
  return unsafeDb.brand.findUnique({ where: { id: brandId }, select: { id: true, code: true, name: true, erpCompanyCode: true } });
}

const EVENT_DELEGATES = { Lead: "lead", Deal: "deal", Quote: "quote", SalesOrder: "salesOrder", Invoice: "invoice", Case: "case", VehicleUnit: "vehicleUnit", Product: "product", JournalEntry: "journalEntry" } as const;
export type EventEntity = keyof typeof EVENT_DELEGATES;

/** Brand of a record, for events raised by the system client (e.g. the approval engine). */
export async function recordBrand(entity: EventEntity, id: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
  const row = await (unsafeDb as any)[EVENT_DELEGATES[entity]].findUnique({ where: { id }, select: { brandId: true } });
  return row?.brandId ?? null;
}

/** Customer e-mail of an invoice (contact first, then account) for the payment provider's receipt. */
export async function invoiceCustomerEmail(invoiceId: string): Promise<string | null> {
  const inv = await unsafeDb.invoice.findUnique({ where: { id: invoiceId }, select: { contactId: true, accountId: true } });
  if (!inv) return null;
  const contact = inv.contactId ? await unsafeDb.contact.findUnique({ where: { id: inv.contactId }, select: { email: true } }) : null;
  if (contact?.email) return contact.email;
  const account = inv.accountId ? await unsafeDb.account.findUnique({ where: { id: inv.accountId }, select: { email: true } }) : null;
  return account?.email ?? null;
}

export function paymentByReference(invoiceId: string, reference: string) {
  return unsafeDb.payment.findFirst({ where: { invoiceId, reference }, select: { id: true } });
}

export function listDeliveriesById(ids: string[]) {
  return unsafeDb.webhookDelivery.findMany({ where: { id: { in: ids } } });
}
