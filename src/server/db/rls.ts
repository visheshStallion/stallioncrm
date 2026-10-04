/**
 * RLS session setter. Every scopedDb operation runs in a short transaction that first switches to
 * the non-owner role `stallion_rls` (subject to RLS policies) and sets the session variables read
 * by the policies in prisma/rls/*.sql. Settings are LOCAL – they vanish at COMMIT/ROLLBACK, so
 * pooled connections never leak one user's context to another.
 */
import type { AccessContext } from "@/server/access/types";
import { rlsMemberships } from "@/server/access/visibility";
import type { UnsafeDb } from "./unsafe";

export const RLS_ROLE = "stallion_rls";

/** Values written to `app.*` settings. */
export function rlsSettings(ctx: AccessContext) {
  return {
    userId: ctx.userId,
    scope: ctx.scope,
    memberships: JSON.stringify(rlsMemberships(ctx)),
    /** "1" exempts administrators from the pending-approval record lock */
    admin: ctx.isAdmin ? "1" : "0",
  };
}

/** The statements to run (in this order) at the start of a scoped transaction. */
export function rlsSessionQueries(db: UnsafeDb, ctx: AccessContext) {
  const s = rlsSettings(ctx);
  return [
    db.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`),
    db.$queryRaw`SELECT set_config('app.user_id', ${s.userId}, true) AS "userId",
                        set_config('app.scope', ${s.scope}, true) AS "scope",
                        set_config('app.memberships', ${s.memberships}, true) AS "memberships",
                        set_config('app.admin', ${s.admin}, true) AS "admin"`,
  ] as const;
}
