/**
 * CSV user import (/admin/users/import). Always dry-run first; commit re-plans the same text and applies
 * only rows that are OK or explicitly overridden. Files are processed in memory and never stored.
 */
import "server-only";
import { territoryKeyString } from "@/server/access/quick-assign";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { assertAdmin } from "./guard";
import { planImport, type ImportLookups, type ImportPlan } from "./import-plan";
import { createUser, setUserTerritories, updateUser } from "./service";

export { IMPORT_COLUMNS, type ImportPlan, type PlanRow } from "./import-plan";

async function loadLookups(ctx: AccessContext): Promise<ImportLookups> {
  const db = scopedDb(ctx);
  const [aliases, brands, roles, profiles, regions, users] = await Promise.all([
    db.brandCodeAlias.findMany({ include: { brand: { select: { code: true } } } }),
    db.brand.findMany({ select: { code: true, status: true } }),
    db.role.findMany({ select: { id: true, name: true } }),
    db.profile.findMany({ select: { id: true, name: true } }),
    db.region.findMany({ where: { active: true }, select: { name: true } }),
    db.user.findMany({ select: { email: true } }),
  ]);
  return {
    aliases: Object.fromEntries(aliases.map((a) => [a.alias.toUpperCase(), a.brand.code])),
    brands: Object.fromEntries(brands.map((b) => [b.code, b.status])),
    roles,
    profiles,
    regions: regions.map((r) => r.name),
    existingEmails: new Set(users.map((u) => u.email.toLowerCase())),
  };
}

export async function dryRunImport(ctx: AccessContext, csvText: string): Promise<ImportPlan> {
  assertAdmin(ctx);
  return planImport(csvText, await loadLookups(ctx));
}

/**
 * Applies the plan: OK rows, plus flagged rows whose line number is in `overrideLines`.
 * Error rows are never imported. Existing users (same email) get role/profile/territories updated.
 */
export async function commitImport(ctx: AccessContext, csvText: string, overrideLines: number[] = []) {
  assertAdmin(ctx);
  const plan = planImport(csvText, await loadLookups(ctx));
  const db = scopedDb(ctx);
  const territories = await db.territory.findMany({
    select: { id: true, level: true, brand: { select: { code: true } }, region: { select: { name: true } } },
  });
  const territoryId = (key: string) =>
    territories.find(
      (t) =>
        territoryKeyString({ brandCode: t.level === 0 ? null : t.brand?.code ?? null, regionName: t.region?.name ?? null }) === key,
    )?.id;

  const overrides = new Set(overrideLines);
  const result = { created: 0, updated: 0, skipped: 0 };
  for (const row of plan.rows) {
    const accept = row.status === "ok" || (row.status === "flagged" && overrides.has(row.line));
    if (!accept || !row.roleId || !row.profileId) {
      result.skipped++;
      continue;
    }
    const ids = row.territories.map(territoryId).filter((x): x is string => !!x);
    const input = { name: row.name, email: row.email, roleId: row.roleId, profileId: row.profileId };
    if (row.action === "update") {
      const existing = await db.user.findUniqueOrThrow({ where: { email: row.email }, select: { id: true, managerId: true } });
      await updateUser(ctx, existing.id, { ...input, managerId: existing.managerId });
      await setUserTerritories(ctx, existing.id, ids);
      result.updated++;
    } else {
      await createUser(ctx, input, ids);
      result.created++;
    }
  }
  await audit({ ctx, action: "IMPORT", entity: "User", after: { ...result, summary: plan.summary } });
  return { ...result, summary: plan.summary };
}
