import "server-only";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";

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
  opts: { take?: number; skip?: number } = {},
): Promise<{ rows: DealRow[]; total: number }> {
  assertCan(ctx, "deals", "read");
  const db = scopedDb(ctx);
  const where = filterWhere(ctx, filters);
  const [rows, total] = await Promise.all([
    db.deal.findMany({
      where,
      select: dealSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: Math.min(opts.take ?? 200, 500),
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
