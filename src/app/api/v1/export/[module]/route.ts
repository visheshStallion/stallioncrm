import { apiHandler } from "@/server/api";
import { exportList } from "@/server/modules/exports/service";
import { requireApiContext } from "@/server/request";

/**
 * Export of a list view as CSV or XLSX (`?format=xlsx`) with the caller's scoping, masking and the list's
 * filters. Needs the module's export permission (403 otherwise); audited. Large results are queued: the
 * browser is sent to /exports, API clients get 202 with the job id.
 */
export const GET = apiHandler<{ params: Promise<{ module: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const url = new URL(req.url);
  const res = await exportList(ctx, (await params).module, url.searchParams.get("format") ?? "csv", Object.fromEntries(url.searchParams));
  if (res.kind === "job") {
    if ((req.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL("/exports?queued=1", url), 303);
    return Response.json({ queued: true, jobId: res.jobId, rows: res.rows }, { status: 202 });
  }
  return new Response(res.body as BodyInit, { headers: { "Content-Type": res.contentType, "Content-Disposition": `attachment; filename="${res.fileName}"`, "Cache-Control": "no-store" } });
});
