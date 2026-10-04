import "server-only";
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { fieldMask } from "@/server/access/field-mask";
import { filterWhere, visibleRegionIds } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { canWriteTo } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { auditTrail, countHiddenLeadMatches } from "@/server/db/system";
import { classifyDuplicates, type DuplicateReport } from "./duplicates";
import type { FieldDef } from "@/server/list/filters";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  OPEN_STATUSES,
  PAYMENT_INTENTS,
  PAYMENT_LABELS,
  PURCHASE_WINDOWS,
  RATINGS,
  SOURCE_LABELS,
  STATUS_LABELS,
  WINDOW_LABELS,
  type LeadFilters,
} from "./schema";

const leadSelect = {
  id: true,
  firstName: true,
  lastName: true,
  mobile: true,
  email: true,
  city: true,
  source: true,
  sourceDetail: true,
  utm: true,
  status: true,
  rating: true,
  unqualifiedReason: true,
  budget: true,
  paymentIntent: true,
  tradeIn: true,
  tradeInNotes: true,
  expectedPurchaseWindow: true,
  consentMarketing: true,
  consentAt: true,
  modelOfInterestId: true,
  modelOfInterest: { select: { id: true, name: true } },
  convertedDealId: true,
  convertedContactId: true,
  convertedAt: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  owner: { select: { name: true } },
  territory: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.LeadSelect;

type LeadRecord = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

/** Serializable row for client components. */
export interface LeadRow {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string;
  mobile: string | null;
  email: string | null;
  city: string | null;
  source: string;
  sourceDetail: string | null;
  utm: Record<string, string> | null;
  status: string;
  rating: string | null;
  unqualifiedReason: string | null;
  budget: number | null;
  paymentIntent: string | null;
  tradeIn: boolean;
  tradeInNotes: string | null;
  expectedPurchaseWindow: string | null;
  consentMarketing: boolean;
  consentAt: string | null;
  modelOfInterestId: string | null;
  modelName: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  territoryName: string | null;
  createdAt: string;
  updatedAt: string;
}

export const leadName = (l: { firstName: string | null; lastName: string }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ");

function toRow(ctx: AccessContext, l: LeadRecord): LeadRow {
  const masked = fieldMask(ctx, "leads", {
    mobile: l.mobile,
    email: l.email,
    budget: l.budget === null ? null : Number(l.budget.toString()),
  });
  return {
    id: l.id,
    name: leadName(l),
    firstName: l.firstName,
    lastName: l.lastName,
    mobile: (masked.mobile as string | null | undefined) ?? null,
    email: (masked.email as string | null | undefined) ?? null,
    city: l.city,
    source: l.source,
    sourceDetail: l.sourceDetail,
    utm: (l.utm as Record<string, string> | null) ?? null,
    status: l.status,
    rating: l.rating,
    unqualifiedReason: l.unqualifiedReason,
    budget: (masked.budget as number | null | undefined) ?? null,
    paymentIntent: l.paymentIntent,
    tradeIn: l.tradeIn,
    tradeInNotes: l.tradeInNotes,
    expectedPurchaseWindow: l.expectedPurchaseWindow,
    consentMarketing: l.consentMarketing,
    consentAt: l.consentAt?.toISOString() ?? null,
    modelOfInterestId: l.modelOfInterestId,
    modelName: l.modelOfInterest?.name ?? null,
    convertedDealId: l.convertedDealId,
    convertedAt: l.convertedAt?.toISOString() ?? null,
    brandId: l.brandId,
    regionId: l.regionId,
    ownerId: l.ownerId,
    ownerName: l.owner.name,
    territoryName: l.territory?.name ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** Filters → Prisma where. Brand/region values outside the user's access are dropped (narrow, never widen). */
export function leadWhere(ctx: AccessContext, f: LeadFilters): Prisma.LeadWhereInput {
  const q = f.q?.trim();
  return {
    ...filterWhere(ctx, { brandId: f.brandId, regionId: f.regionId }),
    ...(f.status ? { status: f.status } : f.open ? { status: { in: [...OPEN_STATUSES] } } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.rating ? { rating: f.rating } : {}),
    ...(f.mine ? { ownerId: ctx.userId } : f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
            ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { lastName: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { mobile: { contains: q.replace(/\s/g, "") } },
          ],
        }
      : {}),
  };
}

export async function listLeads(
  ctx: AccessContext,
  filters: LeadFilters,
  opts: { take?: number; skip?: number; ids?: string[]; where?: Prisma.LeadWhereInput } = {},
): Promise<{ rows: LeadRow[]; total: number }> {
  assertCan(ctx, "leads", "read");
  const db = scopedDb(ctx);
  const where: Prisma.LeadWhereInput = {
    AND: [leadWhere(ctx, filters), opts.where ?? {}, opts.ids ? { id: { in: opts.ids } } : {}],
  };
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      select: leadSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: Math.min(opts.take ?? 200, 5000),
      skip: opts.skip ?? 0,
    }),
    db.lead.count({ where }),
  ]);
  return { rows: rows.map((r) => toRow(ctx, r)), total };
}

/** 404 for missing AND out-of-scope leads. */
export async function getLead(ctx: AccessContext, id: string): Promise<LeadRow> {
  assertCan(ctx, "leads", "read");
  const lead = await scopedDb(ctx).lead.findUnique({ where: { id }, select: leadSelect });
  if (!lead) throw new NotFoundError();
  return toRow(ctx, lead);
}

export async function searchLeads(ctx: AccessContext, q: string, take = 20) {
  const rows = await scopedDb(ctx).lead.findMany({
    where: leadWhere(ctx, { q }),
    select: { id: true, firstName: true, lastName: true, city: true, status: true, brandId: true, regionId: true },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return rows;
}

/** Timeline: field history (audit trail) now; activities/emails join in prompts 07 / 10. */
export async function leadTimeline(ctx: AccessContext, id: string) {
  await getLead(ctx, id); // visibility check first – never read the trail of a hidden record
  const entries = await auditTrail("Lead", id);
  return entries.map((e) => ({
    id: e.id,
    at: e.at.toISOString(),
    action: e.action,
    user: e.user?.name ?? "System",
    changes: diff(e.before as Record<string, unknown> | null, e.after as Record<string, unknown> | null),
  }));
}

const IGNORED = new Set(["updatedAt", "updatedById", "createdAt", "createdById", "id", "territoryId", "utm"]);
function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }));
}

/** Duplicate check: same-brand visible matches with details; anything else only as "exists". */
export async function findDuplicates(
  ctx: AccessContext,
  input: { brandId: string; mobile: string | null; email: string | null; excludeId?: string },
): Promise<DuplicateReport> {
  const or = [
    ...(input.mobile ? [{ mobile: input.mobile }] : []),
    ...(input.email ? [{ email: input.email }] : []),
  ];
  if (or.length === 0) return { sameBrand: [], existsElsewhere: false, contacts: [] };
  const db = scopedDb(ctx);
  const [visible, contacts] = await Promise.all([
    db.lead.findMany({
      where: { OR: or, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
      select: { id: true, brandId: true, firstName: true, lastName: true, status: true, owner: { select: { name: true } } },
      take: 20,
    }),
    db.contact.findMany({
      where: {
        OR: [
          ...(input.mobile ? [{ mobile: input.mobile }] : []),
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
      select: { id: true, firstName: true, lastName: true, account: { select: { name: true } } },
      take: 10,
    }),
  ]);
  const hidden = await countHiddenLeadMatches(input, [...visible.map((v) => v.id), ...(input.excludeId ? [input.excludeId] : [])]);
  return classifyDuplicates(
    input.brandId,
    visible.map((v) => ({ id: v.id, brandId: v.brandId, name: leadName(v), status: v.status, ownerName: v.owner.name })),
    hidden,
    contacts.map((c) => ({ id: c.id, name: leadName(c), accountName: c.account?.name ?? null })),
  );
}

/** Pickers for the lead form: writable brands/regions, models per brand, possible owners. */
export async function leadFormLookups(ctx: AccessContext) {
  const db = scopedDb(ctx);
  const [brands, regions, products, users] = await Promise.all([
    db.brand.findMany({
      where: { id: { in: ctx.brandIds }, status: { not: "INACTIVE" } },
      select: { id: true, code: true, name: true, color: true },
      orderBy: { code: "asc" },
    }),
    db.region.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.product.findMany({
      where: { brandId: { in: ctx.brandIds }, active: true },
      select: { id: true, name: true, brandId: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const allowedRegions = visibleRegionIds(ctx);
  const writableRegions = regions.filter((r) => allowedRegions === null || allowedRegions.includes(r.id));
  // Defaults: the single brand / single region the user writes to.
  const defaultBrandId = brands.length === 1 ? brands[0]!.id : null;
  const regionOptions = writableRegions.filter((r) => brands.some((b) => canWriteTo(ctx, b.id, r.id)));
  const defaultRegionId = regionOptions.length === 1 ? regionOptions[0]!.id : null;
  return { brands, regions: regionOptions, products, users, defaultBrandId, defaultRegionId };
}

export async function listSavedViews(ctx: AccessContext, module = "leads") {
  return scopedDb(ctx).savedView.findMany({
    where: { userId: ctx.userId, module },
    orderBy: { name: "asc" },
  });
}

/** Fields offered in the leads Filter Panel (whitelist for the generic filter engine). */
export function leadFilterFields(opts: {
  brands: Array<{ id: string; code: string }>;
  regions: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}): FieldDef[] {
  return [
    { key: "lastName", label: "Last name", type: "text", nullable: false },
    { key: "firstName", label: "First name", type: "text" },
    { key: "mobile", label: "Mobile", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "status", label: "Lead status", type: "enum", nullable: false, options: LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) },
    { key: "source", label: "Lead source", type: "enum", nullable: false, options: LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })) },
    { key: "rating", label: "Rating", type: "enum", options: RATINGS.map((r) => ({ value: r, label: r.charAt(0) + r.slice(1).toLowerCase() })) },
    { key: "paymentIntent", label: "Payment intent", type: "enum", options: PAYMENT_INTENTS.map((p) => ({ value: p, label: PAYMENT_LABELS[p] })) },
    { key: "expectedPurchaseWindow", label: "Expected purchase", type: "enum", options: PURCHASE_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w] })) },
    { key: "budget", label: "Budget", type: "number" },
    { key: "tradeIn", label: "Trade-in", type: "boolean", nullable: false },
    { key: "consentMarketing", label: "Marketing consent", type: "boolean", nullable: false },
    { key: "brandId", label: "Brand", type: "enum", nullable: false, options: opts.brands.map((b) => ({ value: b.id, label: b.code })) },
    { key: "regionId", label: "Region", type: "enum", nullable: false, options: opts.regions.map((r) => ({ value: r.id, label: r.name })) },
    { key: "ownerId", label: "Lead owner", type: "enum", nullable: false, options: opts.users.map((u) => ({ value: u.id, label: u.name })) },
    { key: "createdAt", label: "Created time", type: "date", nullable: false },
    { key: "updatedAt", label: "Modified time", type: "date", nullable: false },
  ];
}
