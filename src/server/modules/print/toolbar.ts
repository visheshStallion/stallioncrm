/**
 * The toolbar of the print preview pages (hidden when printing): template, company, paper and orientation as a
 * plain GET form – changing a select reloads the preview – plus Print and Download PDF.
 */
import { escapeHtml as esc } from "@/server/modules/messaging/merge";

interface Option {
  id: string;
  label: string;
}

const select = (name: string, label: string, options: Option[], current: string) =>
  options.length
    ? `<label>${esc(label)} <select name="${esc(name)}" aria-label="${esc(label)}" data-print-control="${esc(name)}">${options.map((o) => `<option value="${esc(o.id)}"${o.id === current ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`
    : "";

export function printToolbar(o: {
  action: string;
  backHref: string;
  /** values that must survive a change of a select (e.g. the ids of a list print) */
  hidden?: Record<string, string>;
  templates?: Option[];
  template?: string;
  /** "Print as company": only for records without a brand and for lists – empty when the letterhead is fixed */
  companies?: Option[];
  company?: string;
  /** shown instead of the company select when the letterhead cannot be chosen */
  fixedCompany?: string;
  paper: string;
  orientation: string;
  pdfHref: string;
}): string {
  return `<form class="toolbar" method="get" action="${esc(o.action)}" data-testid="print-toolbar">
  <a href="${esc(o.backHref)}">← Back</a>
  ${Object.entries(o.hidden ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
  ${select("template", "Template", o.templates ?? [], o.template ?? "")}
  ${o.companies?.length ? select("company", "Print as company", o.companies, o.company ?? "") : o.fixedCompany ? `<span data-testid="print-company">Letterhead: <strong>${esc(o.fixedCompany)}</strong></span>` : ""}
  ${select("paper", "Paper", [{ id: "A4", label: "A4" }, { id: "LETTER", label: "Letter" }], o.paper)}
  ${select("orientation", "Orientation", [{ id: "portrait", label: "Portrait" }, { id: "landscape", label: "Landscape" }], o.orientation)}
  <span class="grow"></span>
  <a href="${esc(o.pdfHref)}" data-testid="print-pdf">Download PDF</a>
  <button type="button" class="primary" data-print-now data-testid="print-now">Print</button>
  <noscript><button type="submit">Apply</button></noscript>
</form>
<script>
document.querySelectorAll("[data-print-control]").forEach(function (el) { el.addEventListener("change", function () { el.form.submit(); }); });
document.querySelector("[data-print-now]").addEventListener("click", function () { window.print(); });
</script>`;
}
