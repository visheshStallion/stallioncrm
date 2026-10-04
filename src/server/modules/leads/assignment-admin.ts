/** Admin CRUD for lead assignment rules (/admin/assignment-rules/leads). Administrators only (404 otherwise). */
import "server-only";
import { z } from "zod";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { assertAdmin } from "@/server/modules/admin/guard";
import { LEAD_SOURCES } from "./schema";

const opt = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const ruleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    active: z.coerce.boolean().default(true),
    brandId: opt,
    regionId: opt,
    source: z
      .enum(LEAD_SOURCES)
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null))
      .transform((v) => v ?? null),
    productId: opt,
    action: z.enum(["ROUND_ROBIN", "SPECIFIC_USER", "TERRITORY_MANAGER"]),
    userId: opt,
  })
  .refine((r) => r.action !== "SPECIFIC_USER" || r.userId, { message: "Choose the user", path: ["userId"] });
export type RuleInput = z.input<typeof ruleSchema>;

export async function listRules(ctx: AccessContext) {
  assertAdmin(ctx);
  return scopedDb(ctx).assignmentRule.findMany({
    where: { module: "leads" },
    include: {
      brand: { select: { code: true } },
      region: { select: { name: true } },
      product: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

export async function createRule(ctx: AccessContext, input: RuleInput) {
  assertAdmin(ctx);
  const data = ruleSchema.parse(input);
  const db = scopedDb(ctx);
  const last = await db.assignmentRule.findFirst({ where: { module: "leads" }, orderBy: { position: "desc" } });
  const rule = await db.assignmentRule.create({ data: { ...data, module: "leads", position: (last?.position ?? 0) + 10 } });
  await audit({ ctx, action: "CREATE", entity: "AssignmentRule", entityId: rule.id, after: rule, brandId: rule.brandId });
  return rule;
}

export async function updateRule(ctx: AccessContext, id: string, input: RuleInput) {
  assertAdmin(ctx);
  const data = ruleSchema.parse(input);
  const db = scopedDb(ctx);
  const before = await db.assignmentRule.findUnique({ where: { id } });
  if (!before) throw new BadRequestError("Unknown rule");
  const rule = await db.assignmentRule.update({ where: { id }, data });
  await audit({ ctx, action: "UPDATE", entity: "AssignmentRule", entityId: id, before, after: rule, brandId: rule.brandId });
  return rule;
}

export async function deleteRule(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  const before = await scopedDb(ctx).assignmentRule.delete({ where: { id } });
  await audit({ ctx, action: "DELETE", entity: "AssignmentRule", entityId: id, before, brandId: before.brandId });
}

/** Moves a rule one place up/down by swapping positions with its neighbour. */
export async function moveRule(ctx: AccessContext, id: string, direction: "up" | "down") {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const rules = await db.assignmentRule.findMany({ where: { module: "leads" }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const i = rules.findIndex((r) => r.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rules.length) return;
  // Re-number densely, then swap.
  const ordered = rules.map((r) => r.id);
  [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
  for (const [idx, ruleId] of ordered.entries()) {
    await db.assignmentRule.update({ where: { id: ruleId }, data: { position: (idx + 1) * 10 } });
  }
  await audit({ ctx, action: "UPDATE", entity: "AssignmentRule", entityId: id, after: { moved: direction } });
}
