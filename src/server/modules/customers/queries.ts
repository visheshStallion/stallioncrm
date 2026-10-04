import "server-only";
import type { Prisma } from "@prisma/client";
import { brandOwnedModelsWith, delegateName } from "@/server/access/brand-owned";
import { assertCan } from "@/server/access/can";
import {
  ACCOUNT_TIERS,
  CONTACT_TIERS,
  customerTier,
  managedBrandIds,
  maskByTier,
  type CustomerTier,
} from "@/server/access/customer-tier";
import { NotFoundError } from "@/server/access/errors";
import { fieldMask } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { normalizePhone } from "@/lib/phone";
import { clusterDuplicates, matchReasons, normalizeName, type MatchReason } from "./dedupe";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic delegate access over brand-owned models */

// ───────────────────────────── tiers ─────────────────────────────

/** Ids (of `field`) that have at least one brand-owned record VISIBLE to the user. */
async function idsWithVisibleRecords(ctx: AccessContext, field: "accountId" | "contactId", ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0 || ctx.scope === "ALL") return out;
  const db = scopedDb(ctx) as any;
  for (const model of brandOwnedModelsWith(field)) {
    const groups: Array<Record<string, string>> = await db[delegateName(model)].groupBy({ by: [field], where: { [field]: { in: ids } } });
    for (const g of groups) if (g[field]) out.add(g[field]!);
  }
  return out;
}

async function linkedBrands(ctx: AccessContext, accountIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (accountIds.length === 0) return map;
  const links = await scopedDb(ctx).customerBrandLink.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, brandId: true } });
  for (const l of links) map.set(l.accountId, [...(map.get(l.accountId) ?? []), l.brandId]);
  return map;
}

/** Tier per account for the viewer (batched). */
export async function accountTiers(ctx: AccessContext, accounts: Array<{ id: string; ownerId: string | null }>): Promise<Map<string, CustomerTier>> {
  const ids = accounts.map((a) => a.id);
  const [visible, links] = await Promise.all([
    idsWithVisibleRecords(ctx, "accountId", ids),
    managedBrandIds(ctx).length ? linkedBrands(ctx, ids) : Promise.resolve(new Map<string, string[]>()),
  ]);
  return new Map(
    accounts.map((a) => [a.id, customerTier(ctx, { ownerId: a.ownerId, hasVisibleBrandRecord: visible.has(a.id), linkedBrandIds: links.get(a.id) ?? [] })]),
  );
}

/** Tier per contact: the best of its account's tier and its own visible records / ownership. */
export async function contactTiers(
  ctx: AccessContext,
  contacts: Array<{ id: string; ownerId: string | null; accountId: string | null; account?: { ownerId: string | null } | null }>,
): Promise<Map<string, CustomerTier>> {
  const accounts = [...new Map(contacts.filter((c) => c.accountId).map((c) => [c.accountId!, { id: c.accountId!, ownerId: c.account?.ownerId ?? null }])).values()];
  const [byAccount, visible] = await Promise.all([accountTiers(ctx, accounts), idsWithVisibleRecords(ctx, "contactId", contacts.map((c) => c.id))]);
  const rank = { BASIC: 0, CONTACT: 1, SENSITIVE: 2 } as const;
  return new Map(
    contacts.map((c) => {
      const own = customerTier(ctx, { ownerId: c.ownerId, hasVisibleBrandRecord: visible.has(c.id), linkedBrandIds: [] });
      const acc = c.accountId ? byAccount.get(c.accountId) ?? "BASIC" : "BASIC";
      return [c.id, rank[acc] > rank[own] ? acc : own];
    }),
  );
}

// ───────────────────────────── accounts ─────────────────────────────

const accountSelect = {
  id: true,
  name: true,
  type: true,
  rcNumber: true,
  industry: true,
  city: true,
  state: true,
  address: true,
  phone: true,
  email: true,
  website: true,
  creditLimit: true,
  kycStatus: true,
  notes: true,
  primaryContactId: true,
  ownerId: true,
  owner: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AccountSelect;
type AccountRecord = Prisma.AccountGetPayload<{ select: typeof accountSelect }>;

export interface AccountRow {
  id: string;
  name: string;
  type: string;
  industry: string | null;
  city: string | null;
  phone: string | null;
  state: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  rcNumber: string | null;
  creditLimit: number | null;
  kycStatus: string | null;
  primaryContactId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tier: CustomerTier;
  createdAt: string;
  updatedAt: string;
}

function toAccountRow(ctx: AccessContext, a: AccountRecord, tier: CustomerTier): AccountRow {
  const full = {
    id: a.id,
    name: a.name,
    type: a.type as string,
    industry: a.industry,
    city: a.city,
    phone: a.phone,
    state: a.state,
    address: a.address,
    email: a.email,
    website: a.website,
    notes: a.notes,
    rcNumber: a.rcNumber,
    creditLimit: a.creditLimit === null ? null : Number(a.creditLimit.toString()),
    kycStatus: a.kycStatus as string | null,
    primaryContactId: a.primaryContactId,
    ownerId: a.ownerId,
    ownerName: a.owner?.name ?? null,
    tier,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
  // Tier first, then any additional profile-level field restrictions.
  return fieldMask(ctx, "accounts", maskByTier(tier, full, ACCOUNT_TIERS)) as AccountRow;
}

/** Search by name or phone. Searching a FULL phone number works for everyone; results stay masked per tier. */
function accountSearchWhere(q: string | undefined): Prisma.AccountWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const phone = normalizePhone(term);
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      ...(phone && term.replace(/\D/g, "").length >= 10 ? [{ phone }, { contacts: { some: { mobile: phone, deletedAt: null } } }] : []),
    ],
  };
}

export async function listAccounts(
  ctx: AccessContext,
  opts: { q?: string; where?: Prisma.AccountWhereInput; take?: number; skip?: number } = {},
): Promise<{ rows: AccountRow[]; total: number }> {
  assertCan(ctx, "accounts", "read");
  const db = scopedDb(ctx);
  const where: Prisma.AccountWhereInput = { AND: [{ deletedAt: null }, accountSearchWhere(opts.q), opts.where ?? {}] };
  const [records, total] = await Promise.all([
    db.account.findMany({ where, select: accountSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: Math.min(opts.take ?? 20, 5000), skip: opts.skip ?? 0 }),
    db.account.count({ where }),
  ]);
  const tiers = await accountTiers(ctx, records);
  return { rows: records.map((r) => toAccountRow(ctx, r, tiers.get(r.id) ?? "BASIC")), total };
}

export async function getAccount(ctx: AccessContext, id: string): Promise<AccountRow> {
  assertCan(ctx, "accounts", "read");
  const record = await scopedDb(ctx).account.findFirst({ where: { id, deletedAt: null }, select: accountSelect });
  if (!record) throw new NotFoundError();
  const tiers = await accountTiers(ctx, [record]);
  return toAccountRow(ctx, record, tiers.get(id) ?? "BASIC");
}

/**
 * "Brands this customer buys". Scope ALL sees every linked brand; everyone else sees only brands in which
 * they can access at least one record of this customer – a link in a region they cannot see gives no hint.
 */
export async function accountBrands(ctx: AccessContext, accountId: string): Promise<string[]> {
  if (ctx.scope === "ALL") {
    const links = await scopedDb(ctx).customerBrandLink.findMany({ where: { accountId }, select: { brandId: true }, orderBy: { firstSeenAt: "asc" } });
    return links.map((l) => l.brandId);
  }
  const db = scopedDb(ctx) as any;
  const brands = new Set<string>();
  for (const model of brandOwnedModelsWith("accountId")) {
    const groups: Array<{ brandId: string }> = await db[delegateName(model)].groupBy({ by: ["brandId"], where: { accountId } });
    for (const g of groups) brands.add(g.brandId);
  }
  return [...brands].sort();
}

/** Related deals through the scoped client: only deals the viewer can access – no count or hint of others. */
export async function accountDeals(ctx: AccessContext, where: { accountId: string } | { contactId: string }) {
  const rows = await scopedDb(ctx).deal.findMany({
    where,
    select: { id: true, name: true, stage: true, amount: true, closeDate: true, brandId: true, regionId: true, owner: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map((d) => ({ ...d, amount: d.amount === null ? null : Number(d.amount.toString()), closeDate: d.closeDate?.toISOString() ?? null, ownerName: d.owner.name }));
}

// ───────────────────────────── contacts ─────────────────────────────

const contactSelect = {
  id: true,
  accountId: true,
  account: { select: { id: true, name: true, ownerId: true } },
  firstName: true,
  lastName: true,
  mobile: true,
  altPhone: true,
  email: true,
  dateOfBirth: true,
  gender: true,
  city: true,
  address: true,
  preferredChannel: true,
  ownerId: true,
  owner: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ContactSelect;
type ContactRecord = Prisma.ContactGetPayload<{ select: typeof contactSelect }>;

export interface ContactRow {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string;
  accountId: string | null;
  accountName: string | null;
  city: string | null;
  mobile: string | null;
  altPhone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  preferredChannel: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tier: CustomerTier;
  createdAt: string;
  updatedAt: string;
}

function toContactRow(ctx: AccessContext, c: ContactRecord, tier: CustomerTier): ContactRow {
  const full = {
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" "),
    firstName: c.firstName,
    lastName: c.lastName,
    accountId: c.accountId,
    accountName: c.account?.name ?? null,
    city: c.city,
    mobile: c.mobile,
    altPhone: c.altPhone,
    email: c.email,
    dateOfBirth: c.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    gender: c.gender,
    address: c.address,
    preferredChannel: c.preferredChannel,
    ownerId: c.ownerId,
    ownerName: c.owner?.name ?? null,
    tier,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
  return fieldMask(ctx, "contacts", maskByTier(tier, full, CONTACT_TIERS)) as ContactRow;
}

function contactSearchWhere(q: string | undefined): Prisma.ContactWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const phone = normalizePhone(term);
  return {
    OR: [
      { lastName: { contains: term, mode: "insensitive" } },
      { firstName: { contains: term, mode: "insensitive" } },
      { account: { name: { contains: term, mode: "insensitive" } } },
      ...(phone && term.replace(/\D/g, "").length >= 10 ? [{ mobile: phone }] : []),
    ],
  };
}

export async function listContacts(
  ctx: AccessContext,
  opts: { q?: string; where?: Prisma.ContactWhereInput; take?: number; skip?: number } = {},
): Promise<{ rows: ContactRow[]; total: number }> {
  assertCan(ctx, "contacts", "read");
  const db = scopedDb(ctx);
  const where: Prisma.ContactWhereInput = { AND: [{ deletedAt: null }, contactSearchWhere(opts.q), opts.where ?? {}] };
  const [records, total] = await Promise.all([
    db.contact.findMany({ where, select: contactSelect, orderBy: [{ lastName: "asc" }, { id: "asc" }], take: Math.min(opts.take ?? 20, 5000), skip: opts.skip ?? 0 }),
    db.contact.count({ where }),
  ]);
  const tiers = await contactTiers(ctx, records);
  return { rows: records.map((r) => toContactRow(ctx, r, tiers.get(r.id) ?? "BASIC")), total };
}

export async function getContact(ctx: AccessContext, id: string): Promise<ContactRow> {
  assertCan(ctx, "contacts", "read");
  const record = await scopedDb(ctx).contact.findFirst({ where: { id, deletedAt: null }, select: contactSelect });
  if (!record) throw new NotFoundError();
  const tiers = await contactTiers(ctx, [record]);
  return toContactRow(ctx, record, tiers.get(id) ?? "BASIC");
}

/** Per-brand marketing consent, limited to brands the viewer can access. */
export async function contactConsents(ctx: AccessContext, contactId: string) {
  const rows = await scopedDb(ctx).contactBrandConsent.findMany({
    where: { contactId, ...(ctx.scope === "ALL" ? {} : { brandId: { in: ctx.brandIds } }) },
    select: { brandId: true, consent: true, at: true },
  });
  return rows.map((r) => ({ brandId: r.brandId, consent: r.consent, at: r.at.toISOString() }));
}

// ───────────────────────────── duplicates ─────────────────────────────

/** Existing customers that match the given details (used on create and in lead conversion). Masked per tier. */
export async function findAccountMatches(
  ctx: AccessContext,
  input: { name: string; city?: string | null; phone?: string | null; email?: string | null; rcNumber?: string | null; excludeId?: string },
): Promise<Array<{ account: AccountRow; reasons: MatchReason[] }>> {
  const prefix = normalizeName(input.name).slice(0, 4);
  const or: Prisma.AccountWhereInput[] = [
    ...(input.phone ? [{ phone: input.phone }] : []),
    ...(input.email ? [{ email: input.email }] : []),
    ...(input.rcNumber ? [{ rcNumber: input.rcNumber }] : []),
    ...(input.city && prefix.length >= 3 ? [{ city: { equals: input.city, mode: "insensitive" as const }, name: { contains: prefix, mode: "insensitive" as const } }] : []),
  ];
  if (or.length === 0) return [];
  const candidates = await scopedDb(ctx).account.findMany({
    where: { deletedAt: null, OR: or, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
    select: accountSelect,
    take: 25,
  });
  const tiers = await accountTiers(ctx, candidates);
  return candidates
    .map((c) => ({ record: c, reasons: matchReasons(input, c) }))
    .filter((m) => m.reasons.length > 0)
    .map((m) => ({ account: toAccountRow(ctx, m.record, tiers.get(m.record.id) ?? "BASIC"), reasons: m.reasons }));
}

/** Duplicate clusters across all accounts (merge wizard – callers must be allowed to merge). */
export async function duplicateAccountGroups(ctx: AccessContext) {
  const all = await scopedDb(ctx).account.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, city: true, phone: true, email: true, rcNumber: true, type: true, createdAt: true, _count: { select: { deals: true, contacts: true } } },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });
  return clusterDuplicates(all).map((g) => ({
    reasons: g.reasons,
    members: g.members.map((m) => ({ id: m.id, name: m.name, city: m.city, phone: m.phone, email: m.email, rcNumber: m.rcNumber, type: m.type as string, deals: m._count.deals, contacts: m._count.contacts })),
  }));
}
