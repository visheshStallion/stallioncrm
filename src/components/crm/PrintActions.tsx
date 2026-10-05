"use client";

import { Mail, Printer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { MenuItem } from "./overlays";

/** Print module of a page address: "/deals/abc" → deals + abc, "/inventory/units/x" → vehicleUnits + x. */
const SINGLE = ["leads", "contacts", "accounts", "deals", "quotes", "salesOrders", "invoices", "activities", "cases", "products", "priceBooks", "campaigns"];
const NESTED: Record<string, string> = { "inventory/documents": "inventoryDocuments", "inventory/units": "vehicleUnits" };
const RESERVED = new Set(["new", "import", "duplicates", "templates", "sla", "solutions", "settings", "scan", "reports", "parts", "journals"]);

export function printTarget(pathname: string): { module: string; id: string | null } | null {
  const parts = pathname.split("/").filter(Boolean);
  const nested = NESTED[`${parts[0]}/${parts[1]}`];
  if (nested) return parts.length === 2 ? { module: nested, id: null } : parts.length === 3 && !RESERVED.has(parts[2]!) ? { module: nested, id: parts[2]! } : null;
  if (!SINGLE.includes(parts[0] ?? "")) return null;
  if (parts.length === 1) return { module: parts[0]!, id: null };
  return parts.length === 2 && !RESERVED.has(parts[1]!) ? { module: parts[0]!, id: parts[1]! } : null;
}

/**
 * "Print" on a record page: opens the print preview (template, letterhead, PDF) in a new tab. Ctrl/⌘+P on the page
 * opens the same preview instead of printing the application's screen.
 */
export function PrintButton() {
  const pathname = usePathname();
  const target = printTarget(pathname);
  const href = target?.id ? `/print/${target.module}/${target.id}` : null;
  useEffect(() => {
    if (!href) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.open(href, "_blank", "noopener");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href]);
  if (!href) return null;
  return (
    <Button asChild variant="outline">
      <a href={href} target="_blank" rel="noopener" data-testid="print-record" title="Print or download as PDF (Ctrl+P)">
        <Printer className="h-4 w-4" /> Print
      </a>
    </Button>
  );
}

const listKey = (module: string) => `crm:list:${module}`;

function usePrintView() {
  const pathname = usePathname();
  const target = printTarget(pathname);
  const open = () => {
    if (!target) return;
    let ids: string[] = [];
    try {
      // the list page remembers the ids it shows (also used for previous / next on record pages)
      const key = target.module === "inventoryDocuments" ? "inventory-documents" : target.module === "vehicleUnits" ? "inventory-units" : target.module;
      ids = JSON.parse(window.sessionStorage.getItem(listKey(key)) ?? window.sessionStorage.getItem(listKey(target.module)) ?? "[]") as string[];
    } catch {
      ids = [];
    }
    if (!ids.length) ids = idsOnPage(pathname);
    if (!ids.length) return toast("There are no records on this page to print", "error");
    const title = document.querySelector("[data-testid='view-selector']")?.textContent?.trim() ?? document.querySelector("main h1")?.textContent?.trim() ?? "";
    window.open(`/print/list/${target.module}?ids=${ids.slice(0, 500).join(",")}${title ? `&title=${encodeURIComponent(title)}` : ""}`, "_blank", "noopener");
  };
  return { target, open };
}

/** The ids of the records a list page shows: its table rows, or the links to its records. */
function idsOnPage(pathname: string): string[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("main [data-testid='data-row'][data-id]")).map((r) => r.dataset.id!);
  if (rows.length) return [...new Set(rows)];
  const base = pathname.replace(/\/$/, "");
  const ids = Array.from(document.querySelectorAll<HTMLAnchorElement>(`main a[href^="${base}/"]`))
    .map((a) => a.getAttribute("href")!.slice(base.length + 1).split(/[/?#]/)[0]!)
    .filter((id) => id && !RESERVED.has(id));
  return [...new Set(ids)];
}

/** "Print view" in a list's Actions menu: the records shown on the page as a table on a letterhead. */
export function PrintViewItem() {
  const { target, open } = usePrintView();
  if (!target || target.id) return null;
  return (
    <MenuItem onClick={open}>
      <Printer className="h-4 w-4" /> Print view
    </MenuItem>
  );
}

/** The same as a button, for list pages without an Actions menu (rendered by PageTitleRow on list addresses only). */
export function PrintViewButton() {
  const { target, open } = usePrintView();
  if (!target || target.id) return null;
  return (
    <Button variant="outline" type="button" onClick={open} data-testid="print-view">
      <Printer className="h-4 w-4" /> Print view
    </Button>
  );
}

/** In the bulk bar of a list: the selected records as one PDF or a ZIP of PDFs (background job → Exports page). */
export function BulkPrint({ module, ids }: { module: string; ids: string[] }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: "pdf" | "zip") => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/print/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module, ids, format }) });
      const body = (await res.json()) as { data?: { records: number }; error?: { message: string } };
      if (!res.ok) toast(body.error?.message ?? "The print job could not be started", "error");
      else toast(`Printing ${body.data!.records} record(s) – the file will be ready under Exports`, "success");
    } catch {
      toast("The print job could not be started", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => run("pdf")} data-testid="bulk-print">
        <Printer className="h-3.5 w-3.5" /> Print / Download PDF
      </Button>
      <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => run("zip")} title="One PDF per record, in a ZIP file">
        ZIP
      </Button>
    </>
  );
}

/** Reports and dashboards: the browser's print dialog (the application chrome is hidden by the print CSS). */
export function PrintPageButton() {
  return (
    <Button variant="outline" type="button" onClick={() => window.print()} data-testid="print-page">
      <Printer className="h-4 w-4" /> Print / PDF
    </Button>
  );
}

const EMAIL_PARENT: Record<string, string> = { leads: "Lead", deals: "Deal", cases: "Case", contacts: "Contact", accounts: "Account", quotes: "Quote", salesOrders: "SalesOrder", invoices: "Invoice" };

/** documents go out with their PDF attached: the composer opens with the brand's default document template chosen */
const DOCUMENTS = new Set(["Quote", "SalesOrder", "Invoice"]);

/** "Send Email" on a record page: opens the e-mail composer for the record (brand sender, templates, attachments). */
export function SendEmailButton() {
  const target = printTarget(usePathname());
  const type = target?.id ? EMAIL_PARENT[target.module] : undefined;
  if (!type) return null;
  return (
    <Button variant="outline" asChild>
      <Link href={`/email/compose?type=${type}&id=${target!.id}${DOCUMENTS.has(type) ? "&attach=1" : ""}`} data-testid="send-email">
        <Mail className="h-4 w-4" /> Send Email
      </Link>
    </Button>
  );
}

const BULK_SEND = new Set(["quotes", "salesOrders", "invoices", "deals"]);

/** In the bulk bar of a document list: send each selected record to its customer as a PDF (opens the send dialog page). */
export function BulkSend({ module, ids }: { module: string; ids: string[] }) {
  if (!BULK_SEND.has(module) || ids.length === 0 || ids.length > 100) return null;
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/templates/documents/send?module=${module}&ids=${ids.join(",")}`} data-testid="bulk-send">
        <Mail className="h-3.5 w-3.5" /> Send documents
      </Link>
    </Button>
  );
}

const TEMPLATE_MODULES = new Set(["leads", "deals", "cases", "accounts", "contacts"]);

/** "Save as template" on a record page: its reusable values become a personal record template (prompt 22). */
export function SaveAsTemplateButton() {
  const target = printTarget(usePathname());
  if (!target?.id || !TEMPLATE_MODULES.has(target.module)) return null;
  return (
    <Button variant="ghost" asChild>
      <Link href={`/templates/records/from?module=${target.module}&id=${target.id}`} data-testid="save-as-template" title="Save this record's values as a record template">
        Save as template
      </Link>
    </Button>
  );
}
