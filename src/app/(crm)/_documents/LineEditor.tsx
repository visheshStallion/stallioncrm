"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveDocumentAction } from "@/server/modules/documents/actions";
import type { DocLine } from "@/server/modules/documents/queries";
import { computeTotals } from "@/server/modules/documents/totals";

export interface EditorProduct {
  id: string;
  name: string;
  price: number | null;
  taxRatePct: number;
  maxDiscountPct: number | null;
}

interface Row {
  key: string;
  productId: string;
  description: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
  vin: string;
}

const n = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? 0 : Number(s));
const fmt = (v: number) => v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let seq = 0;
const blank = (): Row => ({ key: `n${++seq}`, productId: "", description: "", qty: "1", unitPrice: "0", discountPct: "0", taxRate: "7.5", vin: "" });

/**
 * Line grid of a draft document. The preview totals use the same function as the server, but the server
 * recomputes everything on save – nothing calculated here is trusted. Products are the document brand's only.
 */
export function LineEditor({
  type,
  id,
  currency,
  lines,
  header,
  products,
  dateLabel,
  approvalPct,
  showVin,
}: {
  type: string;
  id: string;
  currency: string;
  lines: DocLine[];
  header: { headerDiscountPct: number; date: string | null; terms: string | null; notes: string | null };
  products: EditorProduct[];
  dateLabel: string;
  /** brand threshold – discounts above it need approval (quotes) */
  approvalPct: number | null;
  showVin: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    lines.map((l) => ({ key: l.id, productId: l.productId ?? "", description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice), discountPct: String(l.discountPct), taxRate: String(l.taxRate), vin: l.vin ?? "" })),
  );
  const [headerDiscount, setHeaderDiscount] = useState(String(header.headerDiscountPct));
  const [date, setDate] = useState(header.date ?? "");
  const [terms, setTerms] = useState(header.terms ?? "");
  const [notes, setNotes] = useState(header.notes ?? "");
  const [pending, start] = useTransition();

  const totals = useMemo(() => computeTotals(rows.map((r) => ({ qty: n(r.qty), unitPrice: n(r.unitPrice), discountPct: n(r.discountPct), taxRate: n(r.taxRate) })), n(headerDiscount)), [rows, headerDiscount]);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const warnings = rows.flatMap((r) => {
    const p = products.find((x) => x.id === r.productId);
    const d = n(r.discountPct);
    return [
      p?.maxDiscountPct !== null && p?.maxDiscountPct !== undefined && d > p.maxDiscountPct ? `${r.description || p.name}: ${d}% is above the price book maximum of ${p.maxDiscountPct}%` : null,
      approvalPct !== null && d > approvalPct ? `${r.description || "Line"}: ${d}% is above the ${approvalPct}% threshold` : null,
    ].filter((x): x is string => !!x);
  });
  if (approvalPct !== null && n(headerDiscount) > approvalPct) warnings.push(`Header discount ${n(headerDiscount)}% is above the ${approvalPct}% threshold`);

  const save = () =>
    start(async () => {
      const res = await saveDocumentAction(type, id, {
        lines: rows.map((r) => ({ productId: r.productId, description: r.description, qty: r.qty, unitPrice: r.unitPrice, discountPct: r.discountPct, taxRate: r.taxRate, vin: r.vin })) as never,
        headerDiscountPct: headerDiscount as never,
        date: date as never,
        terms,
        notes,
      });
      if (!res.ok) return toast(res.error.message, "error");
      toast("Saved", "success");
      router.refresh();
    });

  return (
    <div className="space-y-3" data-testid="line-editor">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-text-muted">
            <tr>
              <th className="w-56 py-1">Product</th>
              <th>Description</th>
              <th className="w-20 text-right">Qty</th>
              <th className="w-36 text-right">Unit price</th>
              <th className="w-20 text-right">Disc %</th>
              <th className="w-20 text-right">VAT %</th>
              {showVin ? <th className="w-40">VIN</th> : null}
              <th className="w-36 text-right">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-border align-top" data-testid="doc-line">
                <td className="py-1 pr-1">
                  <Select
                    value={r.productId}
                    aria-label={`Product line ${i + 1}`}
                    className="h-8 w-full"
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      set(r.key, p ? { productId: p.id, description: r.description || p.name, unitPrice: String(p.price ?? 0), taxRate: String(p.taxRatePct) } : { productId: "" });
                    }}
                  >
                    <option value="">— free text —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="pr-1">
                  <Input value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} className="h-8" aria-label={`Description line ${i + 1}`} />
                </td>
                <td className="pr-1">
                  <Input value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} type="number" min={0} step="1" className="h-8 text-right" aria-label={`Quantity line ${i + 1}`} />
                </td>
                <td className="pr-1">
                  <Input value={r.unitPrice} onChange={(e) => set(r.key, { unitPrice: e.target.value })} type="number" min={0} step="0.01" className="h-8 text-right" aria-label={`Unit price line ${i + 1}`} />
                </td>
                <td className="pr-1">
                  <Input value={r.discountPct} onChange={(e) => set(r.key, { discountPct: e.target.value })} type="number" min={0} max={100} step="0.01" className="h-8 text-right" aria-label={`Discount % line ${i + 1}`} />
                </td>
                <td className="pr-1">
                  <Input value={r.taxRate} onChange={(e) => set(r.key, { taxRate: e.target.value })} type="number" min={0} max={100} step="0.01" className="h-8 text-right" aria-label={`VAT % line ${i + 1}`} />
                </td>
                {showVin ? (
                  <td className="pr-1">
                    <Input value={r.vin} onChange={(e) => set(r.key, { vin: e.target.value })} className="h-8 uppercase" aria-label={`VIN line ${i + 1}`} />
                  </td>
                ) : null}
                <td className="py-2 text-right tabular-nums">{fmt(totals.lineTotals[i] ?? 0)}</td>
                <td>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove line ${i + 1}`} className="p-1.5 text-text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, blank()])}>
        <Plus className="h-4 w-4" /> Add line
      </Button>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            {dateLabel}
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-44" />
          </label>
          <label className="block">
            Terms &amp; conditions
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="mt-1 h-20 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 h-14 w-full rounded-md border border-border bg-background p-2" />
          </label>
        </div>
        <div className="space-y-1 text-[13px]" data-testid="doc-totals">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{fmt(totals.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2">
              Header discount %
              <Input value={headerDiscount} onChange={(e) => setHeaderDiscount(e.target.value)} type="number" min={0} max={100} step="0.01" className="h-8 w-20 text-right" aria-label="Header discount %" />
            </label>
            <span className="tabular-nums">− {fmt(totals.discountTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT</span>
            <span className="tabular-nums">{fmt(totals.taxTotal)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold">
            <span>Total ({currency})</span>
            <span className="tabular-nums" data-testid="doc-total">
              {fmt(totals.total)}
            </span>
          </div>
          {warnings.length ? (
            <ul className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="discount-warnings">
              {warnings.map((w) => (
                <li key={w}>{w} – needs approval</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
