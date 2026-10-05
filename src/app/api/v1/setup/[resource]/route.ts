import { NotFoundError } from "@/server/access/errors";
import { apiHandler } from "@/server/api";
import { tierOf, visibleCatalogue } from "@/server/modules/setup/access";
import { exportConfiguration } from "@/server/modules/setup/config";
import { approvalsPageData } from "@/server/modules/setup/destructive";
import { systemHealth } from "@/server/modules/setup/service";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/setup/{catalogue|health|approvals|config}
 *   catalogue  the Setup functions the caller may open (everyone: at least the personal settings)
 *   health     system health (setupPermission of "system-health")
 *   approvals  four-eyes requests (Super Admin)
 *   config     the configuration as JSON, as a download (Super Admin)
 * A resource outside the caller's tier answers 404, like one that does not exist.
 */
export const GET = apiHandler<{ params: Promise<{ resource: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { resource } = await params;
  switch (resource) {
    case "catalogue":
      return Response.json({ data: { tier: tierOf(ctx), categories: visibleCatalogue(ctx) } });
    case "health":
      return Response.json({ data: await systemHealth(ctx) });
    case "approvals":
      return Response.json({ data: await approvalsPageData(ctx) });
    case "config": {
      const config = await exportConfiguration(ctx);
      return new Response(JSON.stringify(config, null, 2), {
        headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="stallioncrm-config-v${config.version}.json"`, "Cache-Control": "no-store" },
      });
    }
    default:
      throw new NotFoundError();
  }
});
