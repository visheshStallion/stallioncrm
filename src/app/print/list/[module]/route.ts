import { apiHandler } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { printModule } from "@/server/modules/print/modules";
import { companyOptions, renderListPrint } from "@/server/modules/print/service";
import { printToolbar } from "@/server/modules/print/toolbar";
import { requireApiContext } from "@/server/request";

/**
 * GET /print/list/{module}?ids=a,b,c[&title=…][&company=…][&format=pdf]
 * The records of a list view as one table on a letterhead. The ids are the records the user had on screen; each is
 * loaded again with the user's access, so an id of another brand makes the whole request a 404. Customer lists need
 * the export permission.
 */
export const GET = apiHandler<{ params: Promise<{ module: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { module } = await params;
  const url = new URL(req.url);
  const q = url.searchParams;
  const ids = (q.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new BadRequestError("No records to print");
  const orientation = q.get("orientation") === "portrait" ? "portrait" : "landscape";
  const paper = q.get("paper") === "LETTER" ? "LETTER" : "A4";
  const common = { module, ids, companyBrandId: q.get("company") || null, title: q.get("title"), orientation, paper } as const;

  if (q.get("format") === "pdf") {
    const { pdf } = await renderListPrint(ctx, { ...common, format: "pdf" });
    return new Response(pdf!.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf!.fileName}"`, "Cache-Control": "no-store", "X-Print-Pages": String(pdf!.pages) } });
  }
  const hidden = { ids: ids.join(","), ...(q.get("title") ? { title: q.get("title")! } : {}) };
  const pdfQuery = new URLSearchParams({ ...hidden, format: "pdf", orientation, paper, ...(common.companyBrandId ? { company: common.companyBrandId } : {}) });
  const toolbar = printToolbar({
    action: url.pathname,
    backHref: printModule(module)?.path("").replace(/\/$/, "") ?? "/",
    hidden,
    companies: await companyOptions(ctx),
    company: common.companyBrandId ?? "",
    paper,
    orientation,
    pdfHref: `${url.pathname}?${pdfQuery.toString()}`,
  });
  const { html } = await renderListPrint(ctx, { ...common, format: "html", toolbar });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
});
