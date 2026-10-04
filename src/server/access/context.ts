import "server-only";
import { cache } from "react";
import { loadAccessRows, loadAllBrandIds, type AccessRows } from "@/server/db/system";
import { parseFieldPermissions, parsePermissions } from "./permissions";
import type { AccessContext, Membership } from "./types";

/** Pure: builds the context from loaded rows (unit-testable). */
export function buildAccessContext(rows: AccessRows, allBrandIds: string[]): AccessContext {
  const permissions = parsePermissions(rows.profile.permissions);
  const memberships: Membership[] = rows.memberships
    .filter((m) => m.territory.brandId !== null) // the root territory grants nothing by itself
    .map((m) => ({
      territoryId: m.territory.id,
      brandId: m.territory.brandId as string,
      regionId: m.territory.regionId,
      isManager: m.isManager,
    }))
    .sort((a, b) => a.territoryId.localeCompare(b.territoryId));

  const scope = rows.profile.scope;
  return {
    userId: rows.id,
    user: { name: rows.name, email: rows.email, roleName: rows.role.name },
    scope,
    profile: {
      id: rows.profile.id,
      name: rows.profile.name,
      permissions,
      fieldPermissions: parseFieldPermissions(rows.profile.fieldPermissions),
    },
    memberships,
    brandIds:
      scope === "ALL"
        ? allBrandIds
        : [...new Set(memberships.map((m) => m.brandId))].sort(),
    isAdmin: permissions.admin?.edit === true,
  };
}

/** Loads the access context for a user; null when the user is missing or inactive. */
export async function loadAccessContext(userId: string): Promise<AccessContext | null> {
  const rows = await loadAccessRows(userId);
  if (!rows || !rows.active) return null;
  const allBrandIds = rows.profile.scope === "ALL" ? await loadAllBrandIds() : [];
  return buildAccessContext(rows, allBrandIds);
}

/** Request-cached (React `cache`) access context. */
export const getAccessContext = cache(loadAccessContext);
