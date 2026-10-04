import "server-only";
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { auditTrail } from "@/server/db/system";
import type { FieldDef } from "@/server/list/filters";
import { DEAL_STAGES, STAGE_LABELS } from "./schema";

const dealSelect = {
  id: true,
  name: true,
  customerName: true,
  amount: true,
  stage: true,
  closeDate: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  updatedAt: true,
  createdAt: true,
  owner: { select: { name: true } },
  territory: { select: { name: true } },
} as const;

type DealRecord = {
  id: string;
  name: string;
  customerName: string | null;
  amount: { toString(): string } | null;
  stage: string;
  closeDate: Date | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  updatedAt: Date;
  createdAt: Date;
  owner: { name: string };
  territory: { name: string } | null;
};

/** Serializable row for RSC → client components. */
export interface DealRow {
  id: string;
  name: string;
  customerName: string | null;
  amount: number | null;
  stage: string;
  closeDate: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  territoryName: string | null;
  updatedAt: string;
  createdAt: string;
}

function toRow(d: DealRecord): DealRow {
  return {
    id: d.id,
    name: d.name,
    customerName: d.customerName,
    amount: d.amount === null ? null : Number(d.amount.toString()),
    stage: d.stage,
    closeDate: d.closeDate?.toISOString() ?? null,
    brandId: d.brandId,
    regionId: d.regionId,
    ownerId: d.ownerId,
    ownerName: d.owner.name,
    territoryName: d.territory?.name ?? null,
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

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
      take: Math.min(opts.take ?? 200, 1000),
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
  const db = scopedDb(ctx);
  const rows = await db.deal.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, customerName: true, stage: true, brandId: true, regionId: true },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return rows;
}

/** Fields offered in the deals Filter Panel (whitelist for the generic filter engine). */
export function dealFilterFields(opts: {
  brands: Array<{ id: string; code: string }>;
  regions: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}): FieldDef[] {
  return [
    { key: "name", label: "Deal name", type: "text", nullable: false },
    { key: "customerName", label: "Customer", type: "text" },
    { key: "stage", label: "Stage", type: "enum", nullable: false, options: DEAL_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })) },
    { key: "amount", label: "Amount", type: "number" },
    { key: "closeDate", label: "Closing date", type: "date" },
    { key: "brandId", label: "Brand", type: "enum", nullable: false, options: opts.brands.map((b) => ({ value: b.id, label: b.code })) },
    { key: "regionId", label: "Region", type: "enum", nullable: false, options: opts.regions.map((r) => ({ value: r.id, label: r.name })) },
    { key: "ownerId", label: "Owner", type: "enum", nullable: false, options: opts.users.map((u) => ({ value: u.id, label: u.name })) },
    { key: "createdAt", label: "Created time", type: "date", nullable: false },
    { key: "updatedAt", label: "Modified time", type: "date", nullable: false },
  ];
}

/** Field history for the deal timeline (visibility checked first). */
export async function dealTimeline(ctx: AccessContext, id: string) {
  await getDeal(ctx, id);
  const entries = await auditTrail("Deal", id);
  const ignored = new Set(["updatedAt", "updatedById", "createdAt", "createdById", "id", "territoryId"]);
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
