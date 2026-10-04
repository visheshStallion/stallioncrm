import { apiHandler } from "@/server/api";
import { downloadExport } from "@/server/modules/exports/service";
import { requireApiContext } from "@/server/request";

/** Download of a finished export job – its owner only, until the link expires (404 afterwards). Audited. */
export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const file = await downloadExport(ctx, (await params).id);
  return new Response(file.body as BodyInit, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" } });
});
