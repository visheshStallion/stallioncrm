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
  /** mass email / SMS / WhatsApp (campaigns) – Brand Manager and above */
  "massEmail",
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
  /** Super Admin tier (prompt 19): the flag on the user AND the Administrator profile. */
  isSuperAdmin?: boolean;
  /** Brands this user administers as a delegated Brand Admin (Setup limited to those brands). */
  brandAdminOf?: string[];
  /** Setup functions (catalogue keys) the profile may open without being an Administrator. */
  setupSections?: string[];
  /** When the user's sessions were last revoked ("sign out all sessions"); checked against the session's login time. */
  sessionsValidAfter?: Date | null;
  /** When the password was last set (null = never recorded); the password policy may expire it. */
  passwordChangedAt?: Date | null;
  /** Two-step sign-in is switched on for this user (the MFA policy may require it). */
  twoStep?: boolean;
  /** Client IP of the current request, used by audit(). */
  ip?: string | null;
  /**
   * System context (no signed-in user, e.g. web-to-lead intake): createdBy/updatedBy stay null and
   * audit entries have no user. Its memberships still bound what it can create.
   */
  system?: boolean;
  /** Set when the request was authenticated with an API token (prompt 13); used for idempotency keys. */
  tokenId?: string;
  /** Workflow automation context: its writes do not trigger workflow rules again (no cascades). */
  automation?: boolean;
}

/** The minimum shape of a brand-owned record needed for visibility decisions. */
export interface BrandOwnedRef {
  brandId: string;
  regionId: string;
  ownerId?: string | null;
}
