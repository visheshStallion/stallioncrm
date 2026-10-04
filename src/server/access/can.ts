import { ForbiddenError, NotFoundError } from "./errors";
import type { ModuleKey } from "./modules";
import type { AccessContext, Action, BrandOwnedRef } from "./types";
import { canWriteTo, isVisible } from "./visibility";

/** Profile permission only (no record). */
export function hasPermission(ctx: AccessContext, module: ModuleKey, action: Action): boolean {
  return ctx.profile.permissions[module]?.[action] === true;
}

/**
 * Profile permission + visibility.
 * - `create` with a record: the target brand/region must be inside the user's territories.
 * - any other action with a record: the record must be visible (WRITE requires READ, §5).
 */
export function can(
  ctx: AccessContext,
  module: ModuleKey,
  action: Action,
  record?: BrandOwnedRef,
): boolean {
  if (!hasPermission(ctx, module, action)) return false;
  if (!record) return true;
  if (action === "create") return canWriteTo(ctx, record.brandId, record.regionId);
  return isVisible(ctx, record);
}

/**
 * Throws when `can` is false. A record the user cannot see raises NotFoundError (404) – never
 * ForbiddenError – so the existence of other brands' records is not leaked.
 */
export function assertCan(
  ctx: AccessContext,
  module: ModuleKey,
  action: Action,
  record?: BrandOwnedRef,
): void {
  if (record && action !== "create" && !isVisible(ctx, record)) throw new NotFoundError();
  if (!can(ctx, module, action, record)) {
    throw new ForbiddenError(
      record && action === "create"
        ? "You cannot create records for this brand/region"
        : `You do not have ${action} permission on ${module}`,
    );
  }
}
