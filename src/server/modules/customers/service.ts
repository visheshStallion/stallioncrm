import "server-only";
import { toCsv } from "@/lib/csv";
import { assertCan, can } from "@/server/access/can";
import { ACCOUNT_TIERS, CONTACT_TIERS, writableFields } from "@/server/access/customer-tier";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { repointCustomerChildren } from "@/server/db/system";
import { BadRequestError } from "@/server/errors";
import { getAccount, getContact, listAccounts, listContacts } from "./queries";
import { ACCOUNT_BASIC_FIELDS, accountSchema, CONTACT_BASIC_FIELDS, contactSchema, type AccountInput, type ContactInput } from "./schema";

/** Keeps only the keys the caller actually sent (partial updates) and is allowed to write for their tier. */
function pick<T extends Record<string, unknown>>(parsed: T, sent: Record<string, unknown>, allowed: Set<string>): Partial<T> {
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent && allowed.has(k))) as Partial<T>;
}

// ───────────────────────────── accounts ─────────────────────────────

export async function createAccount(ctx: AccessContext, input: AccountInput) {
  assertCan(ctx, "accounts", "create");
  const data = accountSchema.parse(input);
  // Sensitive fields only for users who would see them on any customer (scope ALL).
  const sensitive = ctx.scope === "ALL";
  const account = await scopedDb(ctx).account.create({
    data: {
      ...data,
      rcNumber: data.rcNumber, // RC number may be captured at creation by anyone (needed for dedupe)
      creditLimit: sensitive ? data.creditLimit : null,
      kycStatus: sensitive ? data.kycStatus ?? "NOT_STARTED" : "NOT_STARTED",
      ownerId: ctx.userId,
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
  });
  await audit({ ctx, action: "CREATE", entity: "Account", entityId: account.id, after: account });
  return { id: account.id };
}

/** Updates the fields the user's tier lets them see; anything else in the payload is rejected. */
export async function updateAccount(ctx: AccessContext, id: string, input: Partial<AccountInput>) {
  assertCan(ctx, "accounts", "edit");
  const current = await getAccount(ctx, id);
  const db = scopedDb(ctx);
  const before = await db.account.findUniqueOrThrow({ where: { id } });
  const parsed = accountSchema.partial().parse(input);
  const allowed = writableFields(current.tier, ACCOUNT_TIERS, ACCOUNT_BASIC_FIELDS);
  const denied = Object.keys(input).filter((k) => k in accountSchema.shape && !allowed.has(k));
  if (denied.length) throw new ForbiddenError(`You cannot change: ${denied.join(", ")}`);
  const data = pick(parsed, input, allowed);
  if (data.name !== undefined && !data.name) throw new BadRequestError("Name is required");
  const after = await db.account.update({ where: { id }, data: { ...data, updatedById: ctx.userId } });
  await audit({ ctx, action: "UPDATE", entity: "Account", entityId: id, before, after });
  return { id };
}

// ───────────────────────────── contacts ─────────────────────────────

export async function createContact(ctx: AccessContext, input: ContactInput) {
  assertCan(ctx, "contacts", "create");
  const data = contactSchema.parse(input);
  const db = scopedDb(ctx);
  if (data.accountId && !(await db.account.findFirst({ where: { id: data.accountId, deletedAt: null }, select: { id: true } }))) {
    throw new BadRequestError("Unknown account");
  }
  const contact = await db.contact.create({ data: { ...data, ownerId: ctx.userId, createdById: ctx.userId, updatedById: ctx.userId } });
  await audit({ ctx, action: "CREATE", entity: "Contact", entityId: contact.id, after: contact });
  return { id: contact.id };
}

export async function updateContact(ctx: AccessContext, id: string, input: Partial<ContactInput>) {
  assertCan(ctx, "contacts", "edit");
  const current = await getContact(ctx, id);
  const db = scopedDb(ctx);
  const before = await db.contact.findUniqueOrThrow({ where: { id } });
  const parsed = contactSchema.partial().parse(input);
  const allowed = writableFields(current.tier, CONTACT_TIERS, CONTACT_BASIC_FIELDS);
  const denied = Object.keys(input).filter((k) => k in contactSchema.shape && !allowed.has(k));
  if (denied.length) throw new ForbiddenError(`You cannot change: ${denied.join(", ")}`);
  const after = await db.contact.update({ where: { id }, data: { ...pick(parsed, input, allowed), updatedById: ctx.userId } });
  await audit({ ctx, action: "UPDATE", entity: "Contact", entityId: id, before, after });
  return { id };
}

/**
 * Marketing consent is per brand: a user records it for a brand they work in. Opting out of one brand
 * never changes another brand's consent.
 */
export async function setBrandConsent(ctx: AccessContext, contactId: string, brandId: string, consent: boolean) {
  assertCan(ctx, "contacts", "edit");
  await getContact(ctx, contactId);
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new ForbiddenError("You can only record consent for your own brands");
  const db = scopedDb(ctx);
  const before = await db.contactBrandConsent.findUnique({ where: { contactId_brandId: { contactId, brandId } } });
  const after = await db.contactBrandConsent.upsert({
    where: { contactId_brandId: { contactId, brandId } },
    update: { consent, at: new Date() },
    create: { contactId, brandId, consent },
  });
  await audit({ ctx, action: "UPDATE", entity: "ContactBrandConsent", entityId: contactId, brandId, before, after });
}

// ───────────────────────────── merge ─────────────────────────────

/** Merging is for Administrators and Management (scope ALL + mass-update permission). */
export function canMergeCustomers(ctx: AccessContext): boolean {
  return ctx.scope === "ALL" && can(ctx, "accounts", "massUpdate");
}

const FILL_ACCOUNT = ["rcNumber", "industry", "city", "state", "address", "phone", "email", "website", "creditLimit", "notes", "primaryContactId"] as const;
const FILL_CONTACT = ["accountId", "firstName", "mobile", "altPhone", "email", "dateOfBirth", "gender", "city", "address", "preferredChannel"] as const;

/**
 * Merges duplicate accounts into `masterId`: empty master fields are filled from the duplicates, all children
 * (contacts and every brand-owned record of every brand) move to the master, duplicates are soft-deleted with
 * `mergedIntoId`. Everything is audited.
 */
export async function mergeAccounts(ctx: AccessContext, masterId: string, duplicateIds: string[]) {
  if (!canMergeCustomers(ctx)) throw new ForbiddenError("Only Administrators and Management can merge customers");
  const ids = [...new Set(duplicateIds)].filter((d) => d !== masterId);
  if (ids.length === 0) throw new BadRequestError("Choose at least one duplicate to merge");
  const db = scopedDb(ctx);
  const master = await db.account.findFirst({ where: { id: masterId, deletedAt: null } });
  if (!master) throw new NotFoundError();
  const moved: Record<string, number> = {};
  let fill: Record<string, unknown> = {};
  for (const id of ids) {
    const dup = await db.account.findFirst({ where: { id, deletedAt: null } });
    if (!dup) throw new NotFoundError();
    for (const f of FILL_ACCOUNT) if ((master[f] === null || master[f] === "") && fill[f] === undefined && dup[f] !== null) fill[f] = dup[f];
    const m = await repointCustomerChildren("account", id, masterId);
    for (const [k, v] of Object.entries(m)) moved[k] = (moved[k] ?? 0) + v;
    await db.account.update({ where: { id }, data: { deletedAt: new Date(), mergedIntoId: masterId, updatedById: ctx.userId } });
    await audit({ ctx, action: "DELETE", entity: "Account", entityId: id, before: dup, after: { mergedIntoId: masterId, moved: m } });
  }
  if (Object.keys(fill).length) fill = (await db.account.update({ where: { id: masterId }, data: { ...fill, updatedById: ctx.userId } })) as never;
  await audit({ ctx, action: "UPDATE", entity: "Account", entityId: masterId, before: master, after: { merged: ids, moved } });
  return { masterId, merged: ids.length, moved };
}

export async function mergeContacts(ctx: AccessContext, masterId: string, duplicateIds: string[]) {
  if (!canMergeCustomers(ctx)) throw new ForbiddenError("Only Administrators and Management can merge customers");
  const ids = [...new Set(duplicateIds)].filter((d) => d !== masterId);
  if (ids.length === 0) throw new BadRequestError("Choose at least one duplicate to merge");
  const db = scopedDb(ctx);
  const master = await db.contact.findFirst({ where: { id: masterId, deletedAt: null } });
  if (!master) throw new NotFoundError();
  const moved: Record<string, number> = {};
  const fill: Record<string, unknown> = {};
  for (const id of ids) {
    const dup = await db.contact.findFirst({ where: { id, deletedAt: null } });
    if (!dup) throw new NotFoundError();
    for (const f of FILL_CONTACT) if ((master[f] === null || master[f] === "") && fill[f] === undefined && dup[f] !== null) fill[f] = dup[f];
    const m = await repointCustomerChildren("contact", id, masterId);
    for (const [k, v] of Object.entries(m)) moved[k] = (moved[k] ?? 0) + v;
    await db.contact.update({ where: { id }, data: { deletedAt: new Date(), mergedIntoId: masterId, updatedById: ctx.userId } });
    await audit({ ctx, action: "DELETE", entity: "Contact", entityId: id, before: dup, after: { mergedIntoId: masterId, moved: m } });
  }
  if (Object.keys(fill).length) await db.contact.update({ where: { id: masterId }, data: { ...fill, updatedById: ctx.userId } });
  await audit({ ctx, action: "UPDATE", entity: "Contact", entityId: masterId, before: master, after: { merged: ids, moved } });
  return { masterId, merged: ids.length, moved };
}

// ───────────────────────────── export ─────────────────────────────

/** CSV export – export permission only; every row is masked per the viewer's tier (same as UI and API). */
export async function exportAccounts(ctx: AccessContext, q?: string) {
  assertCan(ctx, "accounts", "export");
  const { rows } = await listAccounts(ctx, { q, take: 5000 });
  await audit({ ctx, action: "EXPORT", entity: "Account", after: { q: q ?? null, rows: rows.length } });
  return toCsv(
    ["id", "name", "type", "industry", "city", "state", "phone", "email", "address", "rcNumber", "creditLimit", "kycStatus", "tier"],
    rows.map((r) => [r.id, r.name, r.type, r.industry, r.city, r.state, r.phone, r.email, r.address, r.rcNumber, r.creditLimit, r.kycStatus, r.tier]),
  );
}

export async function exportContacts(ctx: AccessContext, q?: string) {
  assertCan(ctx, "contacts", "export");
  const { rows } = await listContacts(ctx, { q, take: 5000 });
  await audit({ ctx, action: "EXPORT", entity: "Contact", after: { q: q ?? null, rows: rows.length } });
  return toCsv(
    ["id", "name", "account", "city", "mobile", "email", "address", "dateOfBirth", "tier"],
    rows.map((r) => [r.id, r.name, r.accountName, r.city, r.mobile, r.email, r.address, r.dateOfBirth, r.tier]),
  );
}
