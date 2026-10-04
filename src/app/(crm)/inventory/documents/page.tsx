import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { Pagination } from "@/components/crm/ListPage";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { parsePaging } from "@/server/list/filters";
import { approveIncomingAction, receiveIncomingAction } from "@/server/modules/inventory/actions";
import { DOC_TYPES, INV_DOCS, isDocType, statusLabel } from "@/server/modules/inventory/config";
import { canSeeCost, incomingTransfers, isSalesView, listInvDocuments } from "@/server/modules/inventory/queries";
import { SLOT_LABELS } from "@/server/modules/inventory/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { docTone } from "../tones";

export const metadata = { title: "Inventory documents" };

/** Inventory documents by type. Finance documents (bills, landed cost, vendor credits) need finance access. */
export default async function InvDocumentsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; q?: string; page?: string; per?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (isSalesView(ctx)) forbidden();
  const cost = canSeeCost(ctx);
  const types = DOC_TYPES.filter((t) => INV_DOCS[t].area === "inventory" || cost);
  const type = sp.type && isDocType(sp.type) && types.includes(sp.type) ? sp.type : "PO";
  const cfg = INV_DOCS[type];
  const [ui, dir, prefs] = await Promise.all([getUiFilters(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const [{ rows, total }, incoming] = await Promise.all([listInvDocuments(ctx, type, { brandId: ui.brandId, status: sp.status, q: sp.q }, { take: paging.per, skip: paging.skip }), type === "INTER_BRAND" ? incomingTransfers(ctx) : []]);
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  const open = incoming.filter((t) => t.status === "PENDING_APPROVAL" || t.status === "SHIPPED" || t.status === "APPROVED");
  // receiving side of an inter-brand transfer: the receiving brand's warehouses and items
  const toBrands = [...new Set(open.map((t) => t.toBrandId))];
  const db = scopedDb(ctx);
  const [toWarehouses, toProducts] = open.length ? await Promise.all([db.warehouse.findMany({ where: { brandId: { in: toBrands }, active: true }, select: { id: true, name: true, brandId: true } }), db.product.findMany({ where: { brandId: { in: toBrands }, trackingType: "SERIAL", active: true }, select: { id: true, name: true, brandId: true }, orderBy: { name: "asc" } })]) : [[], []];

  return (
    <div>
      <PageTitleRow
        title={cfg.plural}
        left={
          <span className="text-[13px] text-text-muted" data-testid="total-records">
            {total}
          </span>
        }
        actions={
          !cfg.system && hasPermission(ctx, cfg.area, "create") ? (
            <Button asChild>
              <Link href={`/inventory/documents/new?type=${type}`}>New {cfg.label.toLowerCase()}</Link>
            </Button>
          ) : null
        }
      />
      <nav className="mb-3 flex flex-wrap gap-1" aria-label="Document types" data-testid="doc-types">
        {types.map((t) => (
          <Link key={t} href={`/inventory/documents?type=${t}`} aria-current={t === type ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-[13px]", t === type ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted")}>
            {INV_DOCS[t].plural}
          </Link>
        ))}
      </nav>
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="type" value={type} />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Number, reference or VIN" aria-label="Search documents" className="h-8 w-64" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8">
          <option value="">All statuses</option>
          {cfg.statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      {open.length ? (
        <section className="mb-4 rounded-lg border border-border bg-surface p-4" data-testid="incoming-transfers">
          <h2 className="mb-2 text-[13px] font-semibold">Transfers to your brand</h2>
          <ul className="space-y-3 text-[13px]">
            {open.map((t) => {
              const approvals = (t.data.approvals ?? {}) as Record<string, { name: string }>;
              return (
                <li key={t.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.number}</span>
                    <span>
                      {brand(t.fromBrandId)?.code} → {brand(t.toBrandId)?.code}
                    </span>
                    <StatusPill tone={docTone(t.status)}>{statusLabel(t.status)}</StatusPill>
                    <span className="text-text-muted">{t.lines.map((l) => `${l.vin}${l.price !== null ? ` @ ${formatMoney(l.price)}` : ""}`).join(" · ")}</span>
                  </div>
                  {t.status === "PENDING_APPROVAL" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-text-muted">
                        {(Object.keys(SLOT_LABELS) as Array<keyof typeof SLOT_LABELS>).map((s) => `${SLOT_LABELS[s]}: ${approvals[s]?.name ?? "waiting"}`).join(" · ")}
                      </span>
                      <ActionForm action={approveIncomingAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <SubmitButton size="sm">Approve for {brand(t.toBrandId)?.code}</SubmitButton>
                      </ActionForm>
                    </div>
                  ) : null}
                  {t.status === "SHIPPED" && hasPermission(ctx, "inventory", "edit") ? (
                    <ActionForm action={receiveIncomingAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <Select name="toWarehouseId" required defaultValue="" aria-label="Receiving warehouse" className="h-8">
                        <option value="">Receive into…</option>
                        {toWarehouses
                          .filter((w) => w.brandId === t.toBrandId)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                      </Select>
                      {t.lines.map((l) => (
                        <Select key={l.id} name={`product:${l.id}`} required defaultValue={l.toProductId ?? ""} aria-label={`Item for ${l.vin}`} className="h-8">
                          <option value="">{l.vin}: your item…</option>
                          {toProducts
                            .filter((p) => p.brandId === t.toBrandId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </Select>
                      ))}
                      <SubmitButton size="sm">Receive</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title={`No ${cfg.plural.toLowerCase()}`} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="inv-docs-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Status</th>
                {cost && cfg.costed ? <th className="px-3 py-2 text-right">Total</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0" data-testid="data-row">
                  <td className="px-3 py-2">{brand(d.brandId) ? <BrandBadge brand={brand(d.brandId)!} /> : null}</td>
                  <td className="px-3 py-2">
                    <Link href={`/inventory/documents/${d.id}`} className="font-medium text-primary hover:underline">
                      {d.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatDate(d.docDate, prefs.dateFormat)}</td>
                  <td className="px-3 py-2">{d.vendorName ?? (d.toBrandId ? `→ ${brand(d.toBrandId)?.code ?? ""}` : "—")}</td>
                  <td className="px-3 py-2">{d.reference ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={docTone(d.status)}>{statusLabel(d.status)}</StatusPill>
                  </td>
                  {cost && cfg.costed ? (
                    <td className="px-3 py-2 text-right tabular-nums">
                      {d.currency} {(d.total ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </div>
  );
}
