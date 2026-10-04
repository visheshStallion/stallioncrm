import "server-only";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { createDealSchema, updateDealSchema, type CreateDealInput, type UpdateDealInput } from "./schema";

/**
 * Reference implementation of the module service pattern:
 *   validate (zod) → assertCan (module permission + territory) → scopedDb write (scoped + audited).
 */
export async function createDeal(ctx: AccessContext, input: CreateDealInput) {
  const data = createDealSchema.parse(input);
  assertCan(ctx, "deals", "create", { brandId: data.brandId, regionId: data.regionId });
  // ownerId defaults to the creator; reassignment rules arrive with lead/deal assignment (prompts 02 / 04).
  return scopedDb(ctx).deal.create({ data: { ...data, ownerId: ctx.userId }, select: { id: true } });
}

export async function updateDeal(ctx: AccessContext, id: string, input: UpdateDealInput) {
  const data = updateDealSchema.parse(input);
  const db = scopedDb(ctx);
  const current = await db.deal.findUnique({
    where: { id },
    select: { brandId: true, regionId: true, ownerId: true },
  });
  if (!current) throw new NotFoundError();
  assertCan(ctx, "deals", "edit", current);
  return db.deal.update({ where: { id }, data, select: { id: true } });
}
