import type { ModuleKey } from "./modules";

export type Scope = "ALL" | "TERRITORY";

export const ACTIONS = [
  "read",
  "create",
  "edit",
  "delete",
  "export",
  "massUpdate",
  "approve",
] as const;
export type Action = (typeof ACTIONS)[number];

export type ModulePermissions = Partial<Record<Action, boolean>>;
export type PermissionMap = Partial<Record<ModuleKey, ModulePermissions>>;

/** hidden: removed · masked: partially shown · read: visible · edit: visible + editable */
export type FieldAccess = "hidden" | "masked" | "read" | "edit";
export type FieldPermissionMap = Partial<Record<ModuleKey, Record<string, FieldAccess>>>;

/** A territory membership flattened to what the visibility rule needs. Root (brand NULL) is omitted. */
export interface Membership {
  territoryId: string;
  brandId: string;
  /** NULL = brand-level membership (e.g. Brand Manager) → every region of that brand. */
  regionId: string | null;
  isManager: boolean;
}

export interface AccessContext {
  userId: string;
  user: { name: string; email: string; roleName: string };
  scope: Scope;
  profile: {
    id: string;
    name: string;
    permissions: PermissionMap;
    fieldPermissions: FieldPermissionMap;
  };
  memberships: Membership[];
  /** Brands the user may see (all non-inactive brands for scope ALL). Drives the brand switcher. */
  brandIds: string[];
  isAdmin: boolean;
  /** Client IP of the current request, used by audit(). */
  ip?: string | null;
}

/** The minimum shape of a brand-owned record needed for visibility decisions. */
export interface BrandOwnedRef {
  brandId: string;
  regionId: string;
  ownerId?: string | null;
}
