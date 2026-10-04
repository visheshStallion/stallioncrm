import { NotFoundError } from "@/server/access/errors";
import { apiHandler } from "@/server/api";
import {
  auditLog,
  listBrands,
  listProfiles,
  listRegions,
  listUsers,
  roleTree,
  territoryTree,
} from "@/server/modules/admin/queries";
import { assertAdmin } from "@/server/modules/admin/guard";
import { requireApiContext } from "@/server/request";

const RESOURCES = {
  brands: listBrands,
  regions: listRegions,
  territories: territoryTree,
  roles: roleTree,
  profiles: listProfiles,
  users: (ctx: Parameters<typeof listUsers>[0]) => listUsers(ctx, { status: "all" }),
  audit: async (ctx: Parameters<typeof auditLog>[0]) => (await auditLog(ctx, { take: 200 })).rows,
} as const;

/** GET /api/v1/admin/{brands|regions|territories|roles|profiles|users|audit} – administrators only, 404 otherwise. */
export const GET = apiHandler<{ params: Promise<{ resource: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  assertAdmin(ctx);
  const { resource } = await params;
  const fn = RESOURCES[resource as keyof typeof RESOURCES];
  if (!fn) throw new NotFoundError();
  return Response.json({ data: await fn(ctx) });
});
