"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DropdownMenu } from "@/components/crm/overlays";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCustomerFromDocumentAction,
  createDealFromQuoteAction,
  linkDocumentAction,
  linkTargetsAction,
  quoteToInvoiceAction,
  searchCustomersAction,
} from "@/server/modules/documents/actions";
import type { CustomerHit } from "@/server/modules/documents/lookups";

type Kind = "deal" | "account" | "source";

interface Props {
  type: "quote" | "salesOrder" | "invoice";
  id: string;
  brandId: string;
  status: string;
  links: { dealId: string | null; accountId: string | null; contactId: string | null; sourceDocumentId: string | null };
  canCreateCustomer: boolean;
  canCreateDeal: boolean;
  canInvoiceQuote: boolean;
}

/** One search box for a link target: deals / quotes / sales orders of the brand, or customers the user can see. */
function TargetSearch({ kind, brandId, type, onPick }: { kind: Kind; brandId: string; type: Props["type"]; onPick: (v: { id: string; accountId?: string | null; contactId?: string | null; label: string }) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; label: string; accountId?: string | null; contactId?: string | null }>>([]);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      if (kind === "account") {
        if (q.trim().length < 2) return setHits([]);
        const res = await searchCustomersAction(q);
        if (res.ok) setHits(res.data.map((h: CustomerHit) => ({ id: h.id, accountId: h.accountId, contactId: h.contactId, label: `${h.name}${h.company ? ` · ${h.company}` : ""} (${h.kind})` })));
      } else {
        const res = await linkTargetsAction(brandId, kind === "deal" ? "deal" : type === "salesOrder" ? "quote" : "salesOrder", q);
        if (res.ok) setHits(res.data);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, kind, brandId, type]);
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${kind}`} autoFocus />
      <ul className="max-h-48 overflow-auto" role="listbox" aria-label="Results">
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" role="option" aria-selected={false} className="block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-muted" onClick={() => onPick(h)}>
              {h.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ⋯ on a document: Link to… a deal, a customer (account / contact) or a source document of the same brand; remove a
 * link; create the customer or a deal from the document; invoice a quote directly. The server checks every link.
 */
export function LinkPanel(p: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true; data: { message?: string; redirect?: string } } | { ok: false; error: { message: string } }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "Saved", "success");
      setKind(null);
      if (res.data.redirect) router.push(res.data.redirect);
      else router.refresh();
    });
  const link = (input: Record<string, unknown>) => run(() => linkDocumentAction(p.type, p.id, input));
  const sourceLabel = p.type === "salesOrder" ? "Quote" : "Quote / Sales order";

  return (
    <>
      <DropdownMenu
        label="Document links"
        className="w-64"
        trigger={({ toggle, open, id }) => (
          <Button type="button" variant="outline" onClick={toggle} aria-expanded={open} aria-controls={id} data-testid="doc-more">
            ⋯
          </Button>
        )}
      >
        {(close) => (
          <>
            <div className="crm-menu-title">Link to…</div>
            {(
              [
                ["deal", "Deal", p.links.dealId],
                ["account", "Account / Contact", p.links.accountId ?? p.links.contactId],
                ...(p.type !== "quote" ? [["source", sourceLabel, p.links.sourceDocumentId] as const] : []),
              ] as Array<[Kind, string, string | null]>
            ).map(([k, l, current]) => (
              <button key={k} type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), setKind(k))}>
                {current ? `Change ${l.toLowerCase()}` : l}
              </button>
            ))}
            {p.links.dealId ? (
              <button type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), link({ dealId: null }))}>
                Remove the deal link
              </button>
            ) : null}
            {p.links.accountId || p.links.contactId ? (
              <button type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), link({ accountId: null, contactId: null }))}>
                Remove the customer link
              </button>
            ) : null}
            {p.canCreateCustomer || p.canCreateDeal || p.canInvoiceQuote ? <div className="crm-menu-title border-t border-border">Create</div> : null}
            {p.canCreateCustomer ? (
              <button type="button" role="menuitem" className="crm-menu-item w-full text-left" data-testid="create-customer" onClick={() => (close(), run(() => createCustomerFromDocumentAction(p.type, p.id)))}>
                Create customer from this document
              </button>
            ) : null}
            {p.canCreateDeal ? (
              <button type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), run(() => createDealFromQuoteAction(p.id)))}>
                Create deal from this quote
              </button>
            ) : null}
            {p.canInvoiceQuote ? (
              <button type="button" role="menuitem" className="crm-menu-item w-full text-left" onClick={() => (close(), run(() => quoteToInvoiceAction(p.id)))}>
                Create invoice directly
              </button>
            ) : null}
          </>
        )}
      </DropdownMenu>
      {kind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Link to" data-testid="link-dialog">
          <button type="button" aria-label="Close" className="crm-overlay" onClick={() => setKind(null)} />
          <div className="crm-modal w-full max-w-md space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">Link to {kind === "deal" ? "a deal" : kind === "account" ? "a customer" : "a source document"}</h2>
            <p className="text-xs text-text-muted">Only records of this document’s brand that you can open are offered.{p.status !== "DRAFT" && p.type === "invoice" ? " The invoice’s lines and amounts do not change." : ""}</p>
            {kind === "account" ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} /> Update the bill-to from the customer
              </label>
            ) : null}
            <TargetSearch
              kind={kind}
              brandId={p.brandId}
              type={p.type}
              onPick={(v) =>
                link(kind === "deal" ? { dealId: v.id } : kind === "account" ? { accountId: v.accountId ?? null, contactId: v.contactId ?? null, refreshBillTo: refresh } : { sourceDocumentId: v.id })
              }
            />
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setKind(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
