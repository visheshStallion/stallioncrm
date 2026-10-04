import { apiHandler } from "@/server/api";
import { requireApiContext } from "@/server/request";

/** The caller's access context (no secrets). */
export const GET = apiHandler(async () => {
  const ctx = await requireApiContext();
  return Response.json({
    data: {
      userId: ctx.userId,
      user: ctx.user,
      scope: ctx.scope,
      profile: { name: ctx.profile.name, permissions: ctx.profile.permissions },
      memberships: ctx.memberships,
      brandIds: ctx.brandIds,
      isAdmin: ctx.isAdmin,
    },
  });
});
