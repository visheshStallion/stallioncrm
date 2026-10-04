import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";

/**
 * Administration is only for the Administrator profile (admin.edit). Everyone else gets 404 –
 * the admin area does not reveal that it exists.
 */
export function assertAdmin(ctx: AccessContext): void {
  if (!ctx.isAdmin) throw new NotFoundError();
}
