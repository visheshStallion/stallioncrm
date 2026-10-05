import { apiHandler } from "@/server/api";
import type { Orientation, Paper } from "@/server/modules/print/blocks";
import { companyOptions, loadPrintRecord, renderPrintHtml, renderPrintPdf, templateChoices } from "@/server/modules/print/service";
import { printModule } from "@/server/modules/print/modules";
import { printToolbar } from "@/server/modules/print/toolbar";
import { getUiFilters, requireApiContext } from "@/server/request";

const paperOf = (v: string | null): Paper | null => (v === "LETTER" ? "LETTER" : v === "A4" ? "A4" : null);
const orientationOf = (v: string | null): Orientation | null => (v === "landscape" ? "landscape" : v === "portrait" ? "portrait" : null);

/**
 * GET /print/{module}/{id}             print preview of one record (HTML with print CSS, toolbar hidden on paper)
 * GET /print/{module}/{id}?format=pdf  the same as a PDF download
 *
 * The record is loaded with the caller's access: a record of another brand is a 404 here exactly as on its page.
 * `company` is honoured only for records without a brand; a brand-owned record always prints on its own letterhead.
 */
export const GET = apiHandler<{ params: Promise<{ module: string; id: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { module, id } = await params;
  const url = new URL(req.url);
  const q = url.searchParams;
  const base = { module, recordIds: [id], templateId: q.get("template") || null, companyBrandId: q.get("company") || null, paper: paperOf(q.get("paper")), orientation: orientationOf(q.get("orientation")) };

  if (q.get("format") === "pdf") {
    const pdf = await renderPrintPdf(ctx, { ...base, via: "pdf" });
    return new Response(pdf.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.fileName}"`, "Cache-Control": "no-store", "X-Print-Pages": String(pdf.pages), "X-Print-Engine": pdf.engine } });
  }

  // 404 before anything else is looked up
  const record = await loadPrintRecord(ctx, module, id);
  const shared = !record.brandId;
  const ui = shared ? await getUiFilters(ctx) : null;
  const companies = shared ? await companyOptions(ctx) : [];
  // default of "Print as company": the brand selected in the top-bar switcher
  const company = base.companyBrandId ?? (ui?.brandId && companies.some((c) => c.id === ui.brandId) ? ui.brandId : null);
  const first = await renderPrintHtml(ctx, { ...base, companyBrandId: company, via: "preview" }, { audited: false });
  const p = first.prepared;
  const pdfQuery = new URLSearchParams({ format: "pdf", template: p.template.id, paper: p.options.paper, orientation: p.options.orientation, ...(company ? { company } : {}) });
  const toolbar = printToolbar({
    action: url.pathname,
    backHref: printModule(module)!.path(id),
    templates: (await templateChoices(ctx, record)).map((t) => ({ id: t.id, label: `${t.name}${t.brandCode ? ` (${t.brandCode})` : ""}${t.builtin ? " – built-in" : ""}${t.isDefault ? " – default" : ""}` })),
    template: p.template.id,
    companies: shared ? companies : [],
    company: company ?? p.letterheadFor(record).brandId ?? "group",
    fixedCompany: shared ? undefined : p.letterheadFor(record).legalEntity,
    paper: p.options.paper,
    orientation: p.options.orientation,
    pdfHref: `${url.pathname}?${pdfQuery.toString()}`,
  });
  // rendered again with the toolbar, and audited once
  const { html } = await renderPrintHtml(ctx, { ...base, companyBrandId: company, templateId: p.template.id, via: "preview" }, { toolbar });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
});
