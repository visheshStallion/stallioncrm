/**
 * System-side storage of workflow rules (prompt 08, part B): rules are configuration written by administrators
 * only (the RLS role may read but not write them), and the scheduler scans records of every brand to find the
 * ones a rule applies to. Actions never run here – they run through scopedDb with a brand-bound system context.
 */
import "server-only";
import type { Prisma, WorkflowRule, WorkflowTrigger } from "@prisma/client";
import { delegateName } from "@/server/access/brand-owned";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit } from "./audit";
import { unsafeDb } from "./unsafe";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic over brand-owned delegates */

let cache: { at: number; rules: WorkflowRule[] } | null = null;
const CACHE_MS = 15_000;

export function invalidateRuleCache() {
  cache = null;
}

/** Active rules (cached briefly – they are read on every create / update of a record). */
export async function activeRules(): Promise<WorkflowRule[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), rules: await unsafeDb.workflowRule.findMany({ where: { active: true } }) };
  return cache.rules;
}

export function getRule(id: string) {
  return unsafeDb.workflowRule.findUnique({ where: { id } });
}

export function listRules() {
  return unsafeDb.workflowRule.findMany({ include: { brand: { select: { code: true } } }, orderBy: [{ module: "asc" }, { name: "asc" }] });
}

export interface RuleData {
  name: string;
  description: string | null;
  module: string;
  trigger: WorkflowTrigger;
  triggerConfig: Prisma.InputJsonValue;
  brandId: string | null;
  criteria: Prisma.InputJsonValue;
  actions: Prisma.InputJsonValue;
  active: boolean;
}

/** Administrators only (the caller validates the rule against the module schema first). */
export async function saveRule(ctx: AccessContext, id: string | null, data: RuleData) {
  if (!ctx.isAdmin) throw new NotFoundError();
  const before = id ? await unsafeDb.workflowRule.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError();
  const rule = id ? await unsafeDb.workflowRule.update({ where: { id }, data }) : await unsafeDb.workflowRule.create({ data: { ...data, createdById: ctx.userId } });
  invalidateRuleCache();
  await audit({ ctx, action: id ? "UPDATE" : "CREATE", entity: "WorkflowRule", entityId: rule.id, brandId: rule.brandId, before: before ?? undefined, after: rule });
  return rule;
}

export async function setRuleActive(ctx: AccessContext, id: string, active: boolean) {
  if (!ctx.isAdmin) throw new NotFoundError();
  const rule = await unsafeDb.workflowRule.update({ where: { id }, data: { active } });
  invalidateRuleCache();
  await audit({ ctx, action: "UPDATE", entity: "WorkflowRule", entityId: id, brandId: rule.brandId, after: { active } });
}

export async function deleteRule(ctx: AccessContext, id: string) {
  if (!ctx.isAdmin) throw new NotFoundError();
  const before = await unsafeDb.workflowRule.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  await unsafeDb.workflowRule.delete({ where: { id } });
  invalidateRuleCache();
  await audit({ ctx, action: "DELETE", entity: "WorkflowRule", entityId: id, brandId: before.brandId, before });
}

/**
 * Scheduler scan: ids of the records a scheduled / date-based rule applies to. A rule scoped to a brand only
 * ever finds that brand's records; records of inactive brands are skipped.
 */
export async function scanRecords(model: string, where: Record<string, unknown>, brandId: string | null, take = 500): Promise<Array<{ id: string; brandId: string; updatedAt: Date }>> {
  return (unsafeDb as any)[delegateName(model)].findMany({
    where: { AND: [where, { deletedAt: null, brand: { status: { not: "INACTIVE" } } }, brandId ? { brandId } : {}] },
    select: { id: true, brandId: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take,
  });
}

/** Brand of a record, for binding the automation context. */
export async function recordBrand(model: string, id: string): Promise<{ brandId: string; regionId: string } | null> {
  return (unsafeDb as any)[delegateName(model)].findFirst({ where: { id, deletedAt: null }, select: { brandId: true, regionId: true } });
}

/** Safety net used by the "inherits brand from deal" rules: true when a document's brand / region match its deal. */
export async function documentMatchesDeal(model: "Quote" | "SalesOrder", id: string): Promise<boolean> {
  const doc = await (unsafeDb as any)[delegateName(model)].findUnique({ where: { id }, select: { brandId: true, regionId: true, deal: { select: { brandId: true, regionId: true } } } });
  return !!doc && doc.brandId === doc.deal.brandId && doc.regionId === doc.deal.regionId;
}

/** Repairs a document whose brand / region diverged from its deal (should be impossible – the DB trigger forbids it). */
export async function alignDocumentWithDeal(model: "Quote" | "SalesOrder", id: string): Promise<void> {
  const doc = await (unsafeDb as any)[delegateName(model)].findUnique({ where: { id }, select: { deal: { select: { brandId: true, regionId: true, territoryId: true } } } });
  if (doc) await (unsafeDb as any)[delegateName(model)].update({ where: { id }, data: doc.deal });
}
