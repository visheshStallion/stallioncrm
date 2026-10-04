import "server-only";
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { auditTrail } from "@/server/db/system";
import type { FieldDef } from "@/server/list/filters";
import { parseStringArray, staleness, type StageLike } from "./blueprint";
import { DEFAULT_STAGE_KEYS, STAGE_LABELS } from "./schema";

const dealSelect = {
  id: true,
  name: true,
  customerName: true,
  amount: true,
  currency: true,
  closeDate: true,
  pipelineId: true,
  stageId: true,
  stageEnteredAt: true,
  stage: { select: { key: true, name: true, type: true, order: true, probability: true, maxDaysInStage: true } },
  accountId: true,
  account: { select: { name: true } },
  contactId: true,
  modelId: true,
  model: { select: { name: true } },
  quantity: true,
  colour: true,
  paymentType: true,
  financeBank: true,
  tradeInDetails: true,
  discountPct: true,
  testDriveDate: true,
  depositAmount: true,
  depositReceiptNo: true,
  vinChassisNo: true,
  engineNo: true,
  deliveryDate: true,
  lossReason: true,
  lossCompetitorBrand: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  updatedAt: true,
  createdAt: true,
  owner: { select: { name: true } },
  territory: { select: { name: true } },
} as const satisfies Prisma.DealSelect;

type DealRecord = Prisma.DealGetPayload<{ select: typeof dealSelect }>;
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Serializable row for RSC → client components. */
export interface DealRow {
  id: string;
  name: string;
  customerName: string | null;
  amount: number | null;
  currency: string;
  closeDate: string | null;
  pipelineId: string;
  stageId: string;
  /** stage key (ENQUIRY …) */
  stage: string;
  stageName: string;
  stageType: "OPEN" | "WON" | "LOST";
  probability: number;
  daysInStage: number;
  stale: boolean;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  modelId: string | null;
  modelName: string | null;
  quantity: number;
  colour: string | null;
  paymentType: string | null;
  financeBank: string | null;
  tradeInDetails: string | null;
  discountPct: number | null;
  testDriveDate: string | null;
  depositAmount: number | null;
  depositReceiptNo: string | null;
  vinChassisNo: string | null;
  engineNo: string | null;
  deliveryDate: string | null;
  lossReason: string | null;
  lossCompetitorBrand: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  territoryName: string | null;
  updatedAt: string;
  createdAt: string;
}

function toRow(d: DealRecord): DealRow {
  const stage = d.stage!; // guaranteed by the DB trigger + CHECK constraint
  const s = staleness(d.stageEnteredAt, stage.maxDaysInStage, stage.type);
  return {
    id: d.id,
    name: d.name,
    customerName: d.account?.name ?? d.customerName,
    amount: num(d.amount),
    currency: d.currency,
    closeDate: iso(d.closeDate),
    pipelineId: d.pipelineId!,
    stageId: d.stageId!,
    stage: stage.key,
    stageName: stage.name,
    stageType: stage.type,
    probability: stage.probability,
    daysInStage: s.days,
    stale: s.stale,
    accountId: d.accountId,
    accountName: d.account?.name ?? null,
    contactId: d.contactId,
    modelId: d.modelId,
    modelName: d.model?.name ?? null,
    quantity: d.quantity,
    colour: d.colour,
    paymentType: d.paymentType,
    financeBank: d.financeBank,
    tradeInDetails: d.tradeInDetails,
    discountPct: num(d.discountPct),
    testDriveDate: iso(d.testDriveDate),
    depositAmount: num(d.depositAmount),
    depositReceiptNo: d.depositReceiptNo,
    vinChassisNo: d.vinChassisNo,
    engineNo: d.engineNo,
    deliveryDate: iso(d.deliveryDate),
    lossReason: d.lossReason,
    lossCompetitorBrand: d.lossCompetitorBrand,
    brandId: d.brandId,
    regionId: d.regionId,
    ownerId: d.ownerId,
    ownerName: d.owner.name,
    territoryName: d.territory?.name ?? null,
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

export const OPEN_DEALS = { stage: { type: "OPEN" } } as const satisfies Prisma.DealWhereInput;

export async function listDeals(
  ctx: AccessContext,
  filters: UiFilters = {},
  opts: { take?: number; skip?: number; where?: Prisma.DealWhereInput; orderBy?: Prisma.DealOrderByWithRelationInput[] } = {},
): Promise<{ rows: DealRow[]; total: number }> {
  assertCan(ctx, "deals", "read");
  const db = scopedDb(ctx);
  const where: Prisma.DealWhereInput = { AND: [filterWhere(ctx, filters), opts.where ?? {}] };
  const [rows, total] = await Promise.all([
    db.deal.findMany({
      where,
      select: dealSelect,
      orderBy: opts.orderBy ?? [{ updatedAt: "desc" }, { id: "asc" }],
      take: Math.min(opts.take ?? 200, 2000),
      skip: opts.skip ?? 0,
    }),
    db.deal.count({ where }),
  ]);
  return { rows: rows.map(toRow), total };
}

/** Throws NotFoundError for missing AND out-of-scope deals (no existence leak). */
export async function getDeal(ctx: AccessContext, id: string): Promise<DealRow> {
  assertCan(ctx, "deals", "read");
  const deal = await scopedDb(ctx).deal.findUnique({ where: { id }, select: dealSelect });
  if (!deal) throw new NotFoundError();
  return toRow(deal);
}

export async function searchDeals(ctx: AccessContext, q: string, take = 20) {
  const rows = await scopedDb(ctx).deal.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { vinChassisNo: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, customerName: true, brandId: true, regionId: true, stage: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return rows.map((r) => ({ ...r, stageName: r.stage?.name ?? "" }));
}

// ───────────────────────────── pipelines ─────────────────────────────

export interface PipelineInfo {
  id: string;
  brandId: string;
  name: string;
  isDefault: boolean;
  stages: Array<StageLike & { probability: number; maxDaysInStage: number | null }>;
}

type PipelineRecord = Prisma.PipelineGetPayload<{ include: { stages: true } }>;
export function toPipelineInfo(p: PipelineRecord): PipelineInfo {
  return {
    id: p.id,
    brandId: p.brandId,
    name: p.name,
    isDefault: p.isDefault,
    stages: [...p.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        order: s.order,
        type: s.type,
        probability: s.probability,
        maxDaysInStage: s.maxDaysInStage,
        requiredFields: parseStringArray(s.requiredFields),
        allowedTransitions: s.allowedTransitions === null ? null : parseStringArray(s.allowedTransitions),
      })),
  };
}

/** Pipelines of the user's brands only (the pipeline picker never lists another brand's pipeline). */
export async function listPipelines(ctx: AccessContext): Promise<PipelineInfo[]> {
  const rows = await scopedDb(ctx).pipeline.findMany({
    where: { brandId: { in: ctx.brandIds }, brand: { status: { not: "INACTIVE" } } },
    include: { stages: true },
    orderBy: [{ brand: { code: "asc" } }, { isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(toPipelineInfo);
}

export async function getPipeline(ctx: AccessContext, id: string): Promise<PipelineInfo | null> {
  const p = await scopedDb(ctx).pipeline.findUnique({ where: { id }, include: { stages: true } });
  return p ? toPipelineInfo(p) : null;
}

// ───────────────────────────── record page ─────────────────────────────

/** Stage history (written by a DB trigger; RLS hides it together with the deal). */
export async function dealStageHistory(ctx: AccessContext, id: string) {
  await getDeal(ctx, id);
  const db = scopedDb(ctx);
  const rows = await db.dealStageHistory.findMany({ where: { dealId: id }, orderBy: { at: "desc" }, take: 100 });
  const stageIds = [...new Set(rows.flatMap((r) => [r.fromStageId, r.toStageId]).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const [stages, users] = await Promise.all([
    db.pipelineStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const stageName = (sid: string | null) => stages.find((s) => s.id === sid)?.name ?? null;
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    from: stageName(r.fromStageId),
    to: stageName(r.toStageId) ?? "?",
    user: users.find((u) => u.id === r.userId)?.name ?? "System",
    durationHours: num(r.durationHours),
  }));
}

/** Field history for the deal timeline (visibility checked first). */
export async function dealTimeline(ctx: AccessContext, id: string) {
  await getDeal(ctx, id);
  const entries = await auditTrail("Deal", id);
  const ignored = new Set(["updatedAt", "updatedById", "createdAt", "createdById", "id", "territoryId", "stageEnteredAt", "pipelineId"]);
  return entries.map((e) => {
    const before = (e.before ?? null) as Record<string, unknown> | null;
    const after = (e.after ?? null) as Record<string, unknown> | null;
    const details =
      before && after
        ? Object.keys(after)
            .filter((k) => !ignored.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
            .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }))
        : [];
    return { id: e.id, at: e.at.toISOString(), action: e.action, user: e.user?.name ?? "System", details };
  });
}

/** Pickers for the deal form: models per brand, customers. */
export async function dealFormLookups(ctx: AccessContext) {
  const db = scopedDb(ctx);
  const [products, accounts, contacts] = await Promise.all([
    db.product.findMany({ where: { brandId: { in: ctx.brandIds }, active: true }, select: { id: true, name: true, brandId: true }, orderBy: { name: "asc" } }),
    db.account.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 2000 }),
    db.contact.findMany({ where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, accountId: true }, orderBy: { lastName: "asc" }, take: 2000 }),
  ]);
  return {
    products,
    accounts,
    contacts: contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), accountId: c.accountId })),
  };
}

/** Fields offered in the deals Filter Panel (whitelist for the generic filter engine). */
export function dealFilterFields(opts: {
  brands: Array<{ id: string; code: string }>;
  regions: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  stageKeys?: Array<{ key: string; name: string }>;
}): FieldDef[] {
  const stages = opts.stageKeys ?? DEFAULT_STAGE_KEYS.map((k) => ({ key: k, name: STAGE_LABELS[k]! }));
  return [
    { key: "name", label: "Deal name", type: "text", nullable: false },
    { key: "customerName", label: "Customer", type: "text" },
    { key: "stage", label: "Stage", type: "enum", nullable: false, relation: "stage", column: "key", options: stages.map((s) => ({ value: s.key, label: s.name })) },
    { key: "amount", label: "Amount", type: "number" },
    { key: "closeDate", label: "Closing date", type: "date" },
    { key: "vinChassisNo", label: "VIN / chassis no.", type: "text" },
    {
      key: "paymentType",
      label: "Payment type",
      type: "enum",
      options: [
        { value: "CASH", label: "Cash" },
        { value: "BANK_FINANCE", label: "Bank finance" },
        { value: "LEASE", label: "Lease" },
        { value: "FLEET", label: "Fleet" },
      ],
    },
    { key: "brandId", label: "Brand", type: "enum", nullable: false, options: opts.brands.map((b) => ({ value: b.id, label: b.code })) },
    { key: "regionId", label: "Region", type: "enum", nullable: false, options: opts.regions.map((r) => ({ value: r.id, label: r.name })) },
    { key: "ownerId", label: "Owner", type: "enum", nullable: false, options: opts.users.map((u) => ({ value: u.id, label: u.name })) },
    { key: "createdAt", label: "Created time", type: "date", nullable: false },
    { key: "updatedAt", label: "Modified time", type: "date", nullable: false },
  ];
}
