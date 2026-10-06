import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { gridFromLines } from "@/components/crm/line-grid";
import { LineItemsGrid } from "@/components/crm/LineItemsGrid";
import { PrintButton } from "@/components/crm/PrintActions";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection } from "@/components/crm/record";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { managedBrands } from "@/server/access/brand-tag";
import { isAccessError } from "@/server/access/errors";
import { transitionAction } from "@/server/modules/inventory/actions";
import { INV_DOCS } from "@/server/modules/inventory/config";
import { getPurchaseOrder, poFormData } from "@/server/modules/inventory/purchase-orders";
import { ACTION_LABELS, availableActions } from "@/server/modules/inventory/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { docTone } from "../../inventory/tones";

export const metadata = { title: "Purchase Order" };

const addr = (a: Record<string, string>) => [a.street, a.city, a.state, a.code, a.country].filter(Boolean).join(", ") || null;

/** The PO record page: the form's sections read-only, the workflow buttons, print / PDF, clone and the follow-up documents. */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const po = await getPurchaseOrder(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs, data] = await Promise.all([getDirectory(ctx), getPreferences(ctx), poFormData(ctx, po.brandId)]);
  const df = prefs.dateFormat;
  const brand = dir.brands.find((b) => b.id === po.brandId);
  const canEdit = hasPermission(ctx, "inventory", "edit");
  const canWork = canEdit || hasPermission(ctx, "inventory", "approve");
  const isManager = !!ctx.isAdmin || managedBrands(ctx).includes(po.brandId);
  const actions = (canWork ? availableActions("PO", po.status) : []).filter((a) => a !== "reopen" || isManager);
  const view = data.settings.formViews.find((v) => v.id === po.formViewId);
  const sym = po.currency === "NGN" ? "₦" : po.currency;
  const money = (n: number | null) => (n === null ? "—" : `${sym} ${n.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);
  const next = ["ISSUED", "SENT", "PARTIALLY_RECEIVED"].includes(po.status) && hasPermission(ctx, "inventory", "create") ? (["SHIPMENT", "GRN"] as const) : [];
  const grid = gridFromLines(po.lines, po);

  return (
    <div className="space-y-3" data-testid="po-record">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3" data-testid="record-header">
        <Link href="/inventory/documents?type=PO" className="text-sm text-primary hover:underline">
          ← Purchase Orders
        </Link>
        {brand ? <BrandBadge brand={brand} /> : null}
        <h1 className="text-lg font-semibold">
          <span data-testid="doc-number">{po.number}</span> <span className="font-normal text-text-muted">· {po.subject}</span>
        </h1>
        <StatusPill tone={docTone(po.status)}>
          <span data-testid="doc-status">{po.statusLabel}</span>
        </StatusPill>
        <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="doc-actions">
          {po.status === "DRAFT" && canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/purchaseOrders/${po.id}/edit`}>Edit</Link>
            </Button>
          ) : null}
          {hasPermission(ctx, "inventory", "create") ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/purchaseOrders/new?clone=${po.id}`} data-testid="po-clone">
                Clone
              </Link>
            </Button>
          ) : null}
          <PrintButton />
          <a href={`/api/v1/inventory/documents/${po.id}/pdf`} className="text-sm text-primary underline">
            PDF
          </a>
          {actions.map((a) => (
            <ActionForm key={a} action={transitionAction} confirm={a === "cancel" ? `Cancel ${po.number}?` : a === "reopen" ? `Reopen ${po.number}? Its lines become editable again; this is recorded.` : a === "send" ? `E-mail ${po.number} to ${po.contact?.email ?? po.vendor?.email ?? "the vendor"}?` : undefined}>
              <input type="hidden" name="id" value={po.id} />
              <input type="hidden" name="action" value={a} />
              <SubmitButton size="sm" variant={["reject", "cancel", "reopen", "close"].includes(a) ? "outline" : "default"}>
                {ACTION_LABELS[a] ?? a}
              </SubmitButton>
            </ActionForm>
          ))}
          {next.map((t) => (
            <Button key={t} asChild variant="outline" size="sm">
              <Link href={`/inventory/documents/new?type=${t}&brand=${brand?.code ?? ""}&parent=${po.id}`}>Create {INV_DOCS[t].label.toLowerCase()}</Link>
            </Button>
          ))}
        </div>
      </header>

      <FieldSection title="Purchase Order Information" id="info">
        <Field label="Purchase Order Owner" value={po.owner?.name ?? "—"} />
        <Field label="PO Number" value={po.number} />
        <Field label="Brand / Company" value={brand ? `${brand.code} – ${brand.name}` : "—"} />
        <Field label="Vendor Name" value={po.vendor?.name ?? "—"} />
        <Field label="Subject" value={po.subject} />
        <Field label="Tracking Number" value={po.trackingNumber ?? "—"} hidden={view?.hidden.includes("trackingNumber")} />
        <Field label="Requisition Number" value={po.requisitionNumber ?? "—"} hidden={view?.hidden.includes("requisitionNumber")} />
        <Field label="PO Date" value={formatDate(po.poDate, df)} />
        <Field label="Contact Name" value={po.contact?.name ?? "—"} hidden={view?.hidden.includes("vendorContactId")} />
        <Field label="Carrier" value={po.carrier ?? "—"} hidden={view?.hidden.includes("carrier")} />
        <Field label="Due Date" value={po.dueDate ? formatDate(po.dueDate, df) : "—"} hidden={view?.hidden.includes("dueDate")} />
        <Field label="Sales Commission" value={po.salesCommission === null ? "—" : `₦ ${po.salesCommission.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} hidden={view?.hidden.includes("salesCommission")} />
        <Field label="Excise Duty" value={po.exciseDuty === null ? "—" : `₦ ${po.exciseDuty.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} hidden={view?.hidden.includes("exciseDuty")} />
        <Field label="Currency" value={po.currency} />
        <Field label="Status" value={po.statusLabel} />
        <Field label="Exchange Rate" value={po.exchangeRate} />
        <Field label="Grand Total" value={<span data-testid="doc-total">{money(po.total)}</span>} />
        {po.total !== null && po.currency !== "NGN" ? <Field label="Grand Total (₦)" value={`₦ ${(po.total * po.exchangeRate).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} /> : null}
        {view ? <Field label="Form view" value={view.name} /> : null}
      </FieldSection>
      {view?.hidden.includes("address") ? null : (
        <FieldSection title="Address Information" id="address">
          <Field label="Billing Address" value={addr(po.billTo) ?? "—"} />
          <Field label="Shipping Address" value={addr(po.shipTo) ?? "—"} />
          {po.warehouse ? <Field label="Receiving warehouse" value={po.warehouse.name} /> : null}
        </FieldSection>
      )}
      <section className="crm-section p-4">
        <LineItemsGrid documentType="purchaseOrder" value={grid} products={[]} taxOptions={data.grid.taxes} taxMode={data.grid.taxMode} currency={po.currency} brandId={po.brandId} readOnly showVins />
      </section>
      {view?.hidden.includes("terms") ? null : (
        <FieldSection title="Terms and Conditions" id="terms">
          <Field label="Terms and Conditions" value={<span className="whitespace-pre-wrap">{po.terms || "—"}</span>} />
        </FieldSection>
      )}
      {view?.hidden.includes("description") ? null : (
        <FieldSection title="Description Information" id="description">
          <Field label="Description" value={<span className="whitespace-pre-wrap">{po.description || "—"}</span>} />
        </FieldSection>
      )}
      {po.children.length ? (
        <FieldSection title="Shipments and receipts" id="children">
          {po.children.map((c) => (
            <Field key={c.id} label={INV_DOCS[c.type as keyof typeof INV_DOCS]?.label ?? c.type} value={<Link href={`/inventory/documents/${c.id}`} className="text-primary hover:underline">{`${c.number} · ${c.status.toLowerCase().replace(/_/g, " ")}`}</Link>} />
          ))}
        </FieldSection>
      ) : null}
    </div>
  );
}
