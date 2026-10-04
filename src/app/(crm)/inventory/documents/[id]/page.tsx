import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { completePdiAction, recordCountAction, transitionAction } from "@/server/modules/inventory/actions";
import { DOC_TYPES, INV_DOCS, statusLabel, type InvDocType } from "@/server/modules/inventory/config";
import { canSeeCost, getInvDocument, listWarehouses } from "@/server/modules/inventory/queries";
import { ACTION_LABELS, SLOT_LABELS, availableActions } from "@/server/modules/inventory/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { DocEditor } from "../DocEditor";
import { editorLookups, valuesOf } from "../lookups";
import { docTone } from "../../tones";

export const metadata = { title: "Inventory document" };

/** Which document can follow this one ("Create …" buttons). */
const NEXT: Partial<Record<InvDocType, Array<{ type: InvDocType; statuses: string[] }>>> = {
  PO: [
    { type: "SHIPMENT", statuses: ["ISSUED", "PARTIALLY_RECEIVED"] },
    { type: "GRN", statuses: ["ISSUED", "PARTIALLY_RECEIVED"] },
  ],
  SHIPMENT: [
    { type: "GRN", statuses: ["CLEARED", "DELIVERED", "AT_PORT", "CLEARING", "SHIPPED"] },
    { type: "LANDED_COST", statuses: ["CLEARING", "CLEARED", "DELIVERED"] },
  ],
  GRN: [
    { type: "BILL", statuses: ["RECEIVED"] },
    { type: "LANDED_COST", statuses: ["RECEIVED"] },
  ],
};

export default async function InvDocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  // another brand's document – or a finance document without finance access – does not exist for the caller
  const doc = await getInvDocument(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const cfg = INV_DOCS[doc.type];
  const [dir, prefs, warehouses] = await Promise.all([getDirectory(ctx), getPreferences(ctx), listWarehouses(ctx, doc.brandId)]);
  const df = prefs.dateFormat;
  const brand = dir.brands.find((b) => b.id === doc.brandId);
  const cost = canSeeCost(ctx);
  const whName = (wid: string | null) => warehouses.find((w) => w.id === wid)?.name ?? null;
  const canWork = hasPermission(ctx, cfg.area, "edit") || hasPermission(ctx, cfg.area, "approve");
  const actions = canWork ? availableActions(doc.type, doc.status) : [];
  const editable = !cfg.system && doc.status === cfg.initialStatus && doc.type !== "STOCK_COUNT" && hasPermission(ctx, cfg.area, "edit");
  const money = (v: number | undefined) => (v === undefined ? "" : `${doc.currency} ${v.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);
  const approvals = (doc.data.approvals ?? {}) as Record<string, { name: string }>;
  const checklist = Array.isArray(doc.data.checklist) ? (doc.data.checklist as Array<{ item: string; ok: boolean | null }>) : [];
  const unexpected = Array.isArray(doc.data.unexpected) ? (doc.data.unexpected as string[]) : [];
  const next = (NEXT[doc.type] ?? []).filter((n) => n.statuses.includes(doc.status) && hasPermission(ctx, INV_DOCS[n.type].area, "create") && (INV_DOCS[n.type].area === "inventory" || cost));

  if (edit && editable) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        <h1 className="text-[20px] font-semibold">
          Edit {cfg.label.toLowerCase()} {doc.number}
        </h1>
        <DocEditor cfg={cfg} brandId={doc.brandId} lookups={await editorLookups(ctx, cfg, doc.brandId)} values={valuesOf(doc)} showCost={cost} cancelHref={`/inventory/documents/${doc.id}`} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3" data-testid="record-header">
        <Link href={`/inventory/documents?type=${doc.type}`} className="text-sm text-primary hover:underline">
          ← {cfg.plural}
        </Link>
        {brand ? <BrandBadge brand={brand} /> : null}
        <h1 className="text-lg font-semibold" data-testid="doc-number">
          {doc.number}
        </h1>
        <StatusPill tone={docTone(doc.status)}>
          <span data-testid="doc-status">{statusLabel(doc.status)}</span>
        </StatusPill>
        <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="doc-actions">
          {editable ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/inventory/documents/${doc.id}?edit=1`}>Edit</Link>
            </Button>
          ) : null}
          {doc.type === "PO" && doc.status !== "DRAFT" ? (
            <a href={`/api/v1/inventory/documents/${doc.id}/pdf`} className="text-sm text-primary underline">
              PDF
            </a>
          ) : null}
          {actions
            .filter((a) => a !== "pay" && a !== "reconcile")
            .map((a) => (
              <ActionForm key={a} action={transitionAction} confirm={["cancel", "void", "receive", "allocate", "post", "open", "ship"].includes(a) ? `${ACTION_LABELS[a]} ${doc.number}? This posts to the stock ledger and cannot be edited afterwards.` : undefined}>
                <input type="hidden" name="id" value={doc.id} />
                <input type="hidden" name="action" value={a} />
                <SubmitButton size="sm" variant={a === "reject" || a === "cancel" || a === "void" ? "outline" : "default"}>
                  {ACTION_LABELS[a] ?? a}
                </SubmitButton>
              </ActionForm>
            ))}
          {next.map((n) => (
            <Button key={n.type} asChild variant="outline" size="sm">
              <Link href={`/inventory/documents/new?type=${n.type}&brand=${brand?.code ?? ""}&parent=${doc.id}`}>Create {INV_DOCS[n.type].label.toLowerCase()}</Link>
            </Button>
          ))}
        </div>
      </header>

      <FieldSection title={cfg.label} id="info">
        <Field label="Date" value={formatDate(doc.docDate, df)} />
        {doc.vendorName ? <Field label="Vendor" value={doc.vendorName} /> : null}
        {doc.warehouseId ? <Field label={doc.type === "TRANSFER" ? "From warehouse" : "Warehouse"} value={whName(doc.warehouseId)} /> : null}
        {doc.toWarehouseId && doc.type === "TRANSFER" ? <Field label="To warehouse" value={whName(doc.toWarehouseId)} /> : null}
        {doc.toBrandId ? <Field label="Receiving brand" value={dir.brands.find((b) => b.id === doc.toBrandId)?.code} /> : null}
        {doc.expectedDate ? <Field label={doc.type === "BILL" ? "Due" : doc.type === "SHIPMENT" ? "ETA" : "Expected"} value={formatDate(doc.expectedDate, df)} /> : null}
        {doc.reference ? <Field label={cfg.referenceLabel ?? "Reference"} value={doc.reference} /> : null}
        {doc.parentId ? (
          <Field
            label="Based on"
            value={
              <Link href={`/inventory/documents/${doc.parentId}`} className="text-primary hover:underline">
                {doc.parentNumber}
              </Link>
            }
          />
        ) : null}
        {cost && cfg.costed ? <Field label="Total" value={<span data-testid="doc-total">{money(doc.total)}</span>} /> : null}
        {cost && doc.currency !== "NGN" ? <Field label="Exchange rate" value={`₦ ${doc.exchangeRate} per ${doc.currency} · ${formatMoney((doc.total ?? 0) * doc.exchangeRate)}`} /> : null}
        {cost && doc.type === "BILL" ? <Field label="Paid" value={money(doc.amountPaid)} /> : null}
        {doc.type === "SHIPMENT" ? <Field label="Vessel / container / port" value={[doc.data.vessel, doc.data.container, doc.data.port].filter(Boolean).join(" · ") || null} /> : null}
        {doc.type === "LANDED_COST" ? <Field label="Allocation method" value={String(doc.data.method ?? "VALUE").toLowerCase()} /> : null}
        {doc.data.rejectNote ? <Field label="Sent back" value={`${String(doc.data.rejectedBy ?? "")}: ${String(doc.data.rejectNote)}`} /> : null}
        {doc.notes ? <Field label="Notes" value={doc.notes} /> : null}
      </FieldSection>

      {doc.type === "INTER_BRAND" && doc.status !== "DRAFT" ? (
        <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="approvals">
          <h2 className="mb-2 font-semibold">Approvals (both legal entities)</h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            {(Object.keys(SLOT_LABELS) as Array<keyof typeof SLOT_LABELS>).map((s) => (
              <li key={s}>
                {SLOT_LABELS[s]}: <strong>{approvals[s]?.name ?? "waiting"}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {doc.type === "BILL" && actions.includes("pay") ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <ActionForm action={transitionAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="action" value="pay" />
            <div className="space-y-1">
              <Label htmlFor="amount">Payment ({doc.currency})</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min={0} defaultValue={Math.round(((doc.total ?? 0) - (doc.amountPaid ?? 0)) * 100) / 100} className="h-8 w-48 text-right" />
            </div>
            <SubmitButton size="sm">Record payment</SubmitButton>
          </ActionForm>
        </section>
      ) : null}

      {doc.type === "PDI" ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="pdi-checklist">
          <h2 className="mb-2 text-[13px] font-semibold">
            Pre-delivery inspection – <span className="font-mono">{doc.lines[0]?.vin}</span>
          </h2>
          {doc.status === "PENDING" && hasPermission(ctx, "inventory", "edit") ? (
            <ActionForm action={completePdiAction} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={doc.id} />
              {checklist.map((c) => (
                <label key={c.item} className="flex items-center gap-2">
                  <input type="hidden" name="item" value={c.item} />
                  <input type="checkbox" name={`ok:${c.item}`} /> {c.item}
                </label>
              ))}
              <div className="space-y-1">
                <Label htmlFor="notes">Findings (required when something fails)</Label>
                <Input id="notes" name="notes" maxLength={500} />
              </div>
              <SubmitButton size="sm">Complete inspection</SubmitButton>
              <p className="text-xs text-text-muted">Every item ticked = passed, the unit becomes available for sale. Otherwise the unit goes on hold.</p>
            </ActionForm>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {checklist.map((c) => (
                <li key={c.item}>
                  {c.ok ? "✓" : "✗"} {c.item}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {doc.type === "STOCK_COUNT" && doc.status !== "PLANNED" ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="stock-count">
          <h2 className="mb-2 text-[13px] font-semibold">
            Count – {whName(doc.warehouseId)} · {doc.lines.filter((l) => l.vehicleUnitId && l.data.counted === true).length} of {doc.lines.filter((l) => l.vehicleUnitId).length} vehicles found
          </h2>
          {doc.status === "COUNTING" && hasPermission(ctx, "inventory", "edit") ? (
            <ActionForm action={recordCountAction} className="space-y-3 text-[13px]">
              <input type="hidden" name="id" value={doc.id} />
              <div className="space-y-1">
                <Label htmlFor="vins">Scanned / typed VINs (space, comma or line separated)</Label>
                <textarea id="vins" name="vins" rows={3} className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs" />
              </div>
              {doc.lines.some((l) => !l.vehicleUnitId) ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-text-muted">
                      <th className="py-1">Item</th>
                      <th>Batch</th>
                      <th className="text-right">In the books</th>
                      <th className="text-right">Counted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines
                      .filter((l) => !l.vehicleUnitId)
                      .map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="py-1">{l.description}</td>
                          <td>{l.batchNo ?? ""}</td>
                          <td className="text-right tabular-nums">{l.qty}</td>
                          <td className="text-right">
                            <Input name={`count:${l.id}`} type="number" step="0.01" min={0} aria-label={`Counted ${l.description}`} defaultValue={typeof l.data.counted === "number" ? l.data.counted : ""} className="ml-auto h-7 w-24 text-right" />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : null}
              <SubmitButton size="sm" variant="outline">
                Save count
              </SubmitButton>
            </ActionForm>
          ) : null}
          <ul className="mt-3 grid gap-1 text-[13px] sm:grid-cols-3">
            {doc.lines
              .filter((l) => l.vehicleUnitId)
              .map((l) => (
                <li key={l.id} className="font-mono text-xs">
                  {l.data.counted === true ? "✓" : "·"} {l.vin}
                </li>
              ))}
          </ul>
          {unexpected.length ? <p className="mt-2 text-[13px] font-semibold text-[#b3262b] dark:text-danger">Not expected in this warehouse: {unexpected.join(", ")}</p> : null}
          {doc.status === "COUNTING" && actions.includes("reconcile") ? (
            <ActionForm action={transitionAction} confirm="Close the count? Vehicles not found and quantity differences become a draft adjustment." className="mt-3">
              <input type="hidden" name="id" value={doc.id} />
              <input type="hidden" name="action" value="reconcile" />
              <SubmitButton size="sm">Reconcile</SubmitButton>
            </ActionForm>
          ) : null}
          {doc.data.adjustmentId ? (
            <p className="mt-2 text-[13px]">
              Variances:{" "}
              <Link href={`/inventory/documents/${String(doc.data.adjustmentId)}`} className="text-primary underline">
                draft adjustment
              </Link>
            </p>
          ) : doc.status === "RECONCILED" ? (
            <p className="mt-2 text-[13px] text-text-muted">No variances.</p>
          ) : null}
        </section>
      ) : null}

      {doc.lines.length && doc.type !== "PDI" && doc.type !== "STOCK_COUNT" ? (
        <section className="overflow-x-auto rounded-lg border border-border bg-surface" data-testid="doc-lines">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">VIN</th>
                <th className="px-3 py-2 text-right">Qty</th>
                {cost && cfg.costed ? <th className="px-3 py-2 text-right">Unit cost</th> : null}
                {cost && cfg.costed ? <th className="px-3 py-2 text-right">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">{l.position}</td>
                  <td className="px-3 py-1.5">
                    {l.description}
                    {l.data.action ? <span className="ml-2 text-xs text-text-muted">{String(l.data.action).toLowerCase().replace(/_/g, " ")}</span> : null}
                    {l.data.colour ? <span className="ml-2 text-xs text-text-muted">{String(l.data.colour)}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {l.vehicleUnitId ? (
                      <Link href={`/inventory/units/${l.vehicleUnitId}`} className="text-primary hover:underline">
                        {l.vin}
                      </Link>
                    ) : (
                      (l.vin ?? "")
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                  {cost && cfg.costed ? <td className="px-3 py-1.5 text-right tabular-nums">{l.unitCost?.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td> : null}
                  {cost && cfg.costed ? <td className="px-3 py-1.5 text-right tabular-nums">{l.lineTotal?.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {doc.children.length ? (
        <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="doc-children">
          <h2 className="mb-2 font-semibold">Follow-up documents</h2>
          <ul className="space-y-1">
            {doc.children
              .filter((c) => DOC_TYPES.includes(c.type))
              .map((c) => (
                <li key={c.id}>
                  <Link href={`/inventory/documents/${c.id}`} className="text-primary hover:underline">
                    {c.number}
                  </Link>{" "}
                  <span className="text-text-muted">
                    {INV_DOCS[c.type].label} · {statusLabel(c.status)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {doc.journals.length ? (
        <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="doc-journals">
          <h2 className="mb-2 font-semibold">Journal ({brand?.name})</h2>
          {doc.journals.map((j) => (
            <table key={j.id} className="mb-3 w-full">
              <caption className="pb-1 text-left text-xs text-text-muted">
                {j.number} · {j.memo}
              </caption>
              <tbody>
                {j.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1">{l.account}</td>
                    <td className="w-40 text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</td>
                    <td className="w-40 text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </section>
      ) : null}
    </div>
  );
}
