import "server-only";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { hasTerritoryAccess } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { countCasesInTerritory, countLeadsInTerritory } from "@/server/db/system";
import { decideAssignment, pickRule, type AssignmentDecision, type LeadFacts, type RuleLike } from "./assignment-engine";

/**
 * Resolves the owner for a new lead from the ordered assignment rules (prompt 02 §4). The round-robin
 * pointer of the winning rule is claimed atomically, so concurrent web leads never pick the same slot.
 */
export async function assignLead(ctx: AccessContext, lead: LeadFacts): Promise<AssignmentDecision> {
  return assignRecord(ctx, "leads", lead);
}

/**
 * The same engine for other modules (cases, prompt 11): the module's ordered rules, then round-robin within the
 * record's brand-region territory, then the territory / brand manager.
 */
export async function assignRecord(ctx: AccessContext, module: "leads" | "cases", lead: LeadFacts): Promise<AssignmentDecision> {
  const db = scopedDb(ctx);
  const [rules, territory, brand] = await Promise.all([
    db.assignmentRule.findMany({ where: { module } }),
    db.territory.findUnique({
      where: { brandId_regionId: { brandId: lead.brandId, regionId: lead.regionId } },
      include: {
        manager: { select: { id: true, active: true } },
        members: { include: { user: { select: { id: true, active: true } } } },
      },
    }),
    db.brand.findUnique({ where: { id: lead.brandId }, include: { brandManager: { select: { id: true, active: true } } } }),
  ]);

  let rule = pickRule(rules as RuleLike[], lead);
  if (rule?.action === "ROUND_ROBIN") {
    const rows = await db.$queryRaw<Array<{ rrPointer: number }>>`
      UPDATE "AssignmentRule" SET "rrPointer" = "rrPointer" + 1 WHERE id = ${rule.id} RETURNING "rrPointer"`;
    rule = { ...rule, rrPointer: (rows[0]?.rrPointer ?? 1) - 1 };
  }

  let specificUser = null;
  if (rule?.action === "SPECIFIC_USER" && rule.userId) {
    const target = await loadAccessContext(rule.userId);
    specificUser = {
      id: rule.userId,
      active: !!target,
      hasAccess: !!target && hasTerritoryAccess(target, lead.brandId, lead.regionId),
    };
  }

  return decideAssignment(
    rule,
    {
      territoryMembers: (territory?.members ?? []).filter((m) => !m.isManager).map((m) => m.user),
      territoryManager: territory?.manager ?? null,
      brandManager: brand?.brandManager ?? null,
      specificUser,
    },
    module === "leads" ? await countLeadsInTerritory(lead.brandId, lead.regionId) : await countCasesInTerritory(lead.brandId, lead.regionId),
  );
}
