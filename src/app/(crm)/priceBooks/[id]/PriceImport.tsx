"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { priceImportCommitAction, priceImportDryRunAction } from "@/server/modules/catalogue/actions";
import type { PriceImportRow } from "@/server/modules/catalogue/service";

/** CSV price import: dry-run preview first; only valid rows are applied. The file stays in the browser + DB. */
export function PriceImport({ priceBookId }: { priceBookId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<{ rows: PriceImportRow[]; ok: number; errors: number } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-text-muted">
        Columns: <code>code, price, max_discount_pct, notes</code>. Codes are checked against this brand&apos;s products.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Price CSV file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
          setPlan(null);
        }}
      />
      <textarea
        className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
        placeholder={"code,price,max_discount_pct\nHMNL-SUV-STA,39500000,3"}
        value={text}
        aria-label="Price CSV text"
        onChange={(e) => {
          setText(e.target.value);
          setPlan(null);
        }}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!text.trim() || pending}
          onClick={() =>
            start(async () => {
              const res = await priceImportDryRunAction(priceBookId, text);
              if (!res.ok) return toast(res.error.message, "error");
              setPlan(res.data);
            })
          }
        >
          Dry run
        </Button>
        {plan ? (
          <Button
            type="button"
            size="sm"
            disabled={pending || plan.ok === 0}
            onClick={() =>
              start(async () => {
                const res = await priceImportCommitAction(priceBookId, text);
                if (!res.ok) return toast(res.error.message, "error");
                toast(`${res.data.applied} price(s) imported, ${res.data.skipped} skipped`, "success");
                setPlan(null);
                setText("");
                router.refresh();
              })
            }
          >
            Import {plan.ok} price(s)
          </Button>
        ) : null}
      </div>
      {plan ? (
        <table className="w-full text-xs" data-testid="price-import-preview">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="p-1">Line</th>
              <th className="p-1">Code</th>
              <th className="p-1">Product</th>
              <th className="p-1">Price</th>
              <th className="p-1">Result</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={r.line} className={cn("border-t border-border", r.error && "bg-danger/10")}>
                <td className="p-1">{r.line}</td>
                <td className="p-1 font-mono">{r.code}</td>
                <td className="p-1">{r.productName ?? "—"}</td>
                <td className="p-1">{r.price ?? "—"}</td>
                <td className="p-1">{r.error ?? r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
