"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LineItemsGrid, gridPayload, type GridValue, type LineItemsGridProps } from "@/components/crm/LineItemsGrid";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assignVinsAction, brandProductsAction, invoicePartAction, reopenOrderAction, requestOrderApprovalAction, saveDocumentAction } from "@/server/modules/documents/actions";
import type { GridProduct } from "@/server/modules/documents/lookups";

interface GridSettings {
  taxes: Array<{ name: string; rate: number }>;
  taxMode: "LINE" | "DOCUMENT";
  requireProduct: boolean;
  canAdjust: boolean;
}

/**
 * The lines of a document on its record page: the Ordered Items grid, editable while the document is a draft (with
 * its date, terms and notes), read-only afterwards. The server recomputes everything on save.
 */
export function DocumentLines(p: {
  type: "quote" | "salesOrder" | "invoice";
  id: string;
  brandId: string;
  currency: string;
  editable: boolean;
  initial: GridValue;
  header: { date: string | null; terms: string | null; notes: string | null };
  dateLabel: string;
  settings: GridSettings;
  /** invoices: Other Charges / Excise Duty rows and Amount Paid / Balance Due under the totals */
  extraRows?: LineItemsGridProps["extraRows"];
  afterTotals?: LineItemsGridProps["afterTotals"];
}) {
  const router = useRouter();
  const [grid, setGrid] = useState(p.initial);
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [date, setDate] = useState(p.header.date ?? "");
  const [terms, setTerms] = useState(p.header.terms ?? "");
  const [notes, setNotes] = useState(p.header.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!p.editable) return;
    void brandProductsAction(p.brandId).then((res) => res.ok && setProducts(res.data.products));
  }, [p.brandId, p.editable]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    start(async () => {
      const res = await saveDocumentAction(p.type, p.id, { ...gridPayload(grid), date, terms, notes } as never);
      if (!res.ok) return toast(res.error.message, "error");
      setDirty(false);
      toast("Saved", "success");
      router.refresh();
    });

  return (
    <div className="space-y-3" data-testid={p.editable ? "line-editor" : "doc-lines"}>
      <LineItemsGrid
        documentType={p.type}
        value={grid}
        onChange={(v) => (setGrid(v), setDirty(true))}
        products={products}
        taxOptions={p.settings.taxes}
        taxMode={p.settings.taxMode}
        currency={p.currency}
        brandId={p.brandId}
        readOnly={!p.editable}
        canAdjust={p.settings.canAdjust}
        showVins={p.type !== "quote"}
        requireProduct={p.settings.requireProduct}
        extraRows={p.extraRows}
        afterTotals={p.afterTotals}
      />
      {p.editable ? (
        <div className="grid gap-4 md:grid-cols-[220px_1fr_1fr_auto] md:items-end">
          <label className="block text-[13px]">
            {p.dateLabel}
            <Input type="date" value={date} onChange={(e) => (setDate(e.target.value), setDirty(true))} className="mt-1 h-8" />
          </label>
          <label className="block text-[13px]">
            Terms &amp; conditions
            <textarea value={terms} onChange={(e) => (setTerms(e.target.value), setDirty(true))} className="mt-1 h-16 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block text-[13px]">
            Notes
            <textarea value={notes} onChange={(e) => (setNotes(e.target.value), setDirty(true))} className="mt-1 h-16 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <Button type="button" onClick={save} disabled={pending} data-testid="lines-save">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : terms ? (
        <p className="whitespace-pre-wrap text-xs text-text-muted">{terms}</p>
      ) : null}
    </div>
  );
}

/** Sales order tools: Assign VINs, request discount approval, reopen, invoice part of the order. */
export function OrderTools(p: {
  id: string;
  status: string;
  canEdit: boolean;
  canReopen: boolean;
  canInvoice: boolean;
  needsApproval: boolean;
  lines: Array<{ id: string; description: string; qty: number; invoicedQty: number; vins: string[]; isStockItem: boolean }>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"vins" | "invoice" | null>(null);
  const [vins, setVins] = useState<Record<string, string[]>>(() => Object.fromEntries(p.lines.map((l) => [l.id, [...l.vins, ...Array(Math.max(0, Math.ceil(l.qty) - l.vins.length)).fill("")]])));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.id, String(Math.max(0, l.qty - l.invoicedQty))])));
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true; data: { message?: string; redirect?: string } } | { ok: false; error: { message: string } }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "Done", "success");
      setDialog(null);
      if (res.data.redirect) router.push(res.data.redirect);
      else router.refresh();
    });
  const vehicle = p.lines.filter((l) => l.isStockItem);
  const open = p.lines.filter((l) => l.qty - l.invoicedQty > 0);

  return (
    <>
      {p.canEdit && p.status === "DRAFT" && p.needsApproval ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => requestOrderApprovalAction(p.id))} data-testid="request-approval">
          Request discount approval
        </Button>
      ) : null}
      {p.canEdit && ["DRAFT", "CONFIRMED"].includes(p.status) && vehicle.length ? (
        <Button type="button" variant="outline" onClick={() => setDialog("vins")} data-testid="assign-vins">
          Assign VINs
        </Button>
      ) : null}
      {p.canReopen && p.status === "CONFIRMED" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => window.confirm("Back to draft to change the lines? This is recorded.") && run(() => reopenOrderAction(p.id))}>
          Reopen
        </Button>
      ) : null}
      {p.canInvoice && ["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(p.status) && open.length ? (
        <Button type="button" variant="outline" onClick={() => setDialog("invoice")} data-testid="invoice-part">
          Invoice part…
        </Button>
      ) : null}
      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={dialog === "vins" ? "Assign VINs" : "Invoice part of the order"} data-testid={dialog === "vins" ? "vin-dialog" : "invoice-part-dialog"}>
          <button type="button" aria-label="Close" className="crm-overlay" onClick={() => setDialog(null)} />
          <div className="crm-modal w-full max-w-lg space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{dialog === "vins" ? "Assign VINs – one per unit" : "Invoice part of the order"}</h2>
            {dialog === "vins" ? (
              vehicle.map((l) => (
                <fieldset key={l.id} className="space-y-1">
                  <legend className="text-[13px] font-medium">{l.description}</legend>
                  {(vins[l.id] ?? []).map((v, i) => (
                    <Input key={i} value={v} className="h-8 font-mono uppercase" aria-label={`${l.description}, VIN ${i + 1}`} onChange={(e) => setVins((cur) => ({ ...cur, [l.id]: (cur[l.id] ?? []).map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) }))} />
                  ))}
                </fieldset>
              ))
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th>Line</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Invoiced</th>
                    <th className="text-right">Invoice now</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-1">{l.description}</td>
                      <td className="text-right">{l.qty}</td>
                      <td className="text-right">{l.invoicedQty}</td>
                      <td className="text-right">
                        <Input type="number" min={0} max={l.qty - l.invoicedQty} value={qty[l.id] ?? "0"} onChange={(e) => setQty((c) => ({ ...c, [l.id]: e.target.value }))} className="ml-auto h-8 w-24 text-right" aria-label={`${l.description}, quantity to invoice`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  dialog === "vins"
                    ? run(() => assignVinsAction(p.id, Object.fromEntries(Object.entries(vins).map(([k, v]) => [k, v.map((x) => x.trim()).filter(Boolean)]))))
                    : run(() => invoicePartAction(p.id, Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, Number(v) || 0]))))
                }
                data-testid="dialog-confirm"
              >
                {dialog === "vins" ? "Save VINs" : "Create invoice"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
