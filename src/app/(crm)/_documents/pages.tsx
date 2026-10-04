import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { ApprovalBanner, EmptyState, StatusPill, type Tone } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard } from "@/components/crm/record";
import { PaymentLinks } from "@/components/crm/PaymentLinks";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { parsePaging } from "@/server/list/filters";
import { getPrice, listProducts } from "@/server/modules/catalogue/queries";
import { DOCS, type DocType } from "@/server/modules/documents/config";
import { getDocument, listDocuments, pendingApproval } from "@/server/modules/documents/queries";
import { expireQuotes } from "@/server/modules/documents/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { ApprovalDecision, DocButtons, PaymentForm, type DocButton } from "./DocActions";
import { LineEditor, type EditorProduct } from "./LineEditor";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "primary",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "danger",
  CONFIRMED: "primary",
  ALLOCATED: "info",
  DELIVERED: "success",
  CANCELLED: "danger",
  ISSUED: "primary",
  PART_PAID: "warning",
  PAID: "success",
  VOID: "danger",
};
const money = (v: number, currency: string) => (currency === "NGN" ? formatMoney(v) : `${currency} ${v.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);

/** List page shared by Quotes, Sales Orders and Invoices. */
export async function DocumentListPage({ type, searchParams }: { type: DocType; searchParams: Promise<SP> }) {
  const cfg = DOCS[type];
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, cfg.module, "read")) forbidden();
  if (type === "quote") await expireQuotes(ctx);
  const [dir, ui, prefs] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx)]);
  const view = one(sp.view) ?? "all";
  const paging = parsePaging({ page: one(sp.page), per: one(sp.per) });
  const { rows, total } = await listDocuments(ctx, type, ui, {
    q: one(sp.q),
    status: view in cfg.statuses ? view : undefined,
    mine: view === "mine",
    take: paging.per,
    skip: paging.skip,
  });
  const brand = (id: string) => dir.brands.find((b) => b.id === id);

  return (
    <ModuleListFrame
      title={
        <ViewSelector
          current={view}
          views={[
            { id: "all", name: `All ${cfg.plural}`, group: "system" },
            { id: "mine", name: `My ${cfg.plural}`, group: "system" },
            ...Object.entries(cfg.statuses).map(([id, name]) => ({ id, name: `${name} ${cfg.plural}`, group: "system" as const })),
          ]}
        />
      }
      actions={
        <form className="flex gap-2">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={one(sp.q)} placeholder="Number, deal or customer" className="h-9 w-60" aria-label={`Search ${cfg.plural}`} data-shortcut="filter" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      }
    >
      <div className="overflow-auto rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            title={`No ${cfg.plural.toLowerCase()} in this view`}
            text={type === "quote" ? "Create a quote from a deal (Deal → Create Quote)." : type === "salesOrder" ? "Sales orders are created from accepted quotes." : "Invoices are created from confirmed sales orders."}
          />
        ) : (
          <table className="crm-table w-full">
            <thead className="bg-muted text-left text-[12px] text-text-muted">
              <tr>
                {["Number", "Brand", "Customer", "Deal", "Status", "Issue date", cfg.dateLabel, "Total", "Owner"].map((h) => (
                  <th key={h} className="h-9 whitespace-nowrap px-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/60" data-testid="data-row">
                  <td className="whitespace-nowrap px-3">
                    <Link href={`${cfg.path}/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3">
                    <BrandBadge brand={brand(r.brandId)} />
                  </td>
                  <td className="px-3">{r.customerName ?? "—"}</td>
                  <td className="px-3">
                    <Link href={`/deals/${r.dealId}`} className="hover:underline">
                      {r.dealName}
                    </Link>
                  </td>
                  <td className="px-3">
                    <StatusPill tone={TONES[r.status]}>{cfg.statuses[r.status]}</StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-3">{formatDate(r.issueDate, prefs.dateFormat)}</td>
                  <td className="whitespace-nowrap px-3">{formatDate(r.date, prefs.dateFormat)}</td>
                  <td className="whitespace-nowrap px-3 tabular-nums">{money(r.total, r.currency)}</td>
                  <td className="whitespace-nowrap px-3">{r.ownerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination total={total} page={paging.page} per={paging.per} />
    </ModuleListFrame>
  );
}

/** Which status buttons the viewer gets (the server re-checks every transition). */
function buttonsFor(type: DocType, status: string, canEdit: boolean, canCreateNext: boolean): DocButton[] {
  if (!canEdit) return [];
  if (type === "quote") {
    return [
      ...(status === "DRAFT" ? [{ op: "submit", label: "Submit", variant: "default" as const }] : []),
      ...(status === "APPROVED" ? [{ op: "send", label: "Mark as Sent", variant: "default" as const }] : []),
      ...(["APPROVED", "SENT"].includes(status) ? [{ op: "accept", label: "Accepted by customer" }, { op: "reject", label: "Rejected by customer", confirm: "Mark this quote as rejected by the customer?" }] : []),
      ...(["PENDING_APPROVAL", "APPROVED", "SENT", "EXPIRED"].includes(status) ? [{ op: "revise", label: "Revise", confirm: "Return this quote to draft? A pending approval is cancelled." }] : []),
      ...(status === "ACCEPTED" && canCreateNext ? [{ op: "convert", label: "Create Sales Order", variant: "default" as const, kind: "convert" as const }] : []),
    ];
  }
  if (type === "salesOrder") {
    return [
      ...(status === "DRAFT" ? [{ op: "confirm", label: "Confirm", variant: "default" as const }] : []),
      ...(status === "CONFIRMED" ? [{ op: "allocate", label: "Allocate VIN", variant: "default" as const }] : []),
      ...(status === "ALLOCATED" ? [{ op: "deliver", label: "Mark Delivered", variant: "default" as const, confirm: "Mark as delivered today? The deal moves to Delivery." }] : []),
      ...(["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(status) && canCreateNext ? [{ op: "convert", label: "Create Invoice", kind: "convert" as const }] : []),
      ...(["DRAFT", "CONFIRMED", "ALLOCATED"].includes(status) ? [{ op: "cancel", label: "Cancel order", confirm: "Cancel this sales order?" }] : []),
    ];
  }
  return [
    ...(status === "DRAFT" ? [{ op: "issue", label: "Issue", variant: "default" as const }] : []),
    ...(["DRAFT", "ISSUED"].includes(status) ? [{ op: "void", label: "Void", confirm: "Void this invoice?" }] : []),
  ];
}

/** Record page shared by Quotes, Sales Orders and Invoices: header, status actions, line editor / read-only lines. */
export async function DocumentDetailPage({ type, params }: { type: DocType; params: Promise<{ id: string }> }) {
  const cfg = DOCS[type];
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, cfg.module, "read")) forbidden();
  if (type === "quote") await expireQuotes(ctx);
  // Missing and out-of-scope documents are both 404.
  const doc = await getDocument(ctx, type, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs, brandCfg, approval] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { legalEntity: true, discountApprovalPct: true, status: true } }),
    type === "quote" ? pendingApproval(ctx, "Quote", id) : Promise.resolve(null),
  ]);
  const brand = dir.brands.find((b) => b.id === doc.brandId);
  const region = dir.regions.find((r) => r.id === doc.regionId);
  const canEdit = can(ctx, cfg.module, "edit", doc) && brandCfg.status !== "INACTIVE";
  const editable = canEdit && cfg.editable.includes(doc.status);
  const nextModule = type === "quote" ? "salesOrders" : "invoices";
  const buttons = buttonsFor(type, doc.status, canEdit, can(ctx, nextModule, "create", doc));

  let products: EditorProduct[] = [];
  if (editable && hasPermission(ctx, "products", "read")) {
    const list = await listProducts(ctx, { brandId: doc.brandId, activeOnly: true, take: 500 });
    products = await Promise.all(
      list.rows.map(async (p) => {
        const price = await getPrice(ctx, p.id, new Date(doc.issueDate), doc.priceBookId);
        return { id: p.id, name: p.name, price: price.price, taxRatePct: price.taxRatePct, maxDiscountPct: price.maxDiscountPct };
      }),
    );
  }
  const canDecide = !!approval && (approval.approverId === ctx.userId || (ctx.scope === "ALL" && hasPermission(ctx, "quotes", "approve")));
  const balance = type === "invoice" ? doc.total - (doc.amountPaid ?? 0) : 0;

  return (
    <div>
      <RecordHeader
        backHref={cfg.path}
        brand={brand}
        moduleLabel={cfg.label}
        title={doc.number}
        owner={doc.ownerName}
        meta={<StatusPill tone={TONES[doc.status]}>{cfg.statuses[doc.status]}</StatusPill>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/v1${cfg.path}/${doc.id}/pdf`} target="_blank" rel="noreferrer">
                PDF
              </a>
            </Button>
            <Button variant="outline" disabled title="Email arrives with prompt 10">
              Send Email
            </Button>
            <DocButtons type={type} id={doc.id} buttons={buttons} />
          </>
        }
      />
      <div className="space-y-3">
        {approval ? (
          <ApprovalBanner>
            <strong>Pending approval</strong> by {approval.approverName ?? "the approver"} ({approval.level === 2 ? "Head of Sales" : "Brand Manager"}) – requested by {approval.requestedBy} on{" "}
            {formatDateTime(approval.at, prefs.dateFormat)}.
            <div className="text-xs">{approval.reason}</div>
            <div className="text-xs">The quote cannot be sent or accepted until it is approved.</div>
            {canDecide ? <ApprovalDecision requestId={approval.id} /> : null}
          </ApprovalBanner>
        ) : null}

        <FieldSection title={`${cfg.label} Information`}>
          <Field label="Issued by" value={brandCfg.legalEntity ?? brand?.name} />
          <Field label="Customer" value={doc.accountId ? <Link href={`/accounts/${doc.accountId}`} className="text-primary hover:underline">{doc.customerName}</Link> : doc.customerName} />
          <Field label="Deal" value={<Link href={`/deals/${doc.dealId}`} className="text-primary hover:underline">{doc.dealName}</Link>} />
          <Field label="Region" value={<RegionBadge region={region} />} />
          <Field label="Issue date" value={formatDate(doc.issueDate, prefs.dateFormat)} />
          <Field label={cfg.dateLabel} value={formatDate(doc.date, prefs.dateFormat)} />
        </FieldSection>

        <RelatedListCard id="lines" title="Line items" count={doc.lines.length}>
          {editable ? (
            <LineEditor
              type={type}
              id={doc.id}
              currency={doc.currency}
              lines={doc.lines}
              header={{ headerDiscountPct: doc.headerDiscountPct, date: doc.date, terms: doc.terms, notes: doc.notes }}
              products={products}
              dateLabel={cfg.dateLabel}
              approvalPct={type === "quote" ? Number(brandCfg.discountApprovalPct.toString()) : null}
              showVin={type !== "quote"}
            />
          ) : (
            <div className="space-y-3">
              <table className="w-full text-[13px]" data-testid="doc-lines">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Disc %</th>
                    <th className="text-right">VAT %</th>
                    <th>VIN</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-1.5">{l.description}</td>
                      <td className="text-right">{l.qty}</td>
                      <td className="text-right tabular-nums">{money(l.unitPrice, doc.currency)}</td>
                      <td className="text-right">{l.discountPct || "—"}</td>
                      <td className="text-right">{l.taxRate}</td>
                      <td className="font-mono text-xs">{l.vin ?? "—"}</td>
                      <td className="text-right tabular-nums">{money(l.lineTotal, doc.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto w-72 space-y-1 text-[13px]" data-testid="doc-totals">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(doc.subtotal, doc.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Discount{doc.headerDiscountPct ? ` (incl. ${doc.headerDiscountPct}% header)` : ""}</span>
                  <span className="tabular-nums">− {money(doc.discountTotal, doc.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT</span>
                  <span className="tabular-nums">{money(doc.taxTotal, doc.currency)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums" data-testid="doc-total">
                    {money(doc.total, doc.currency)}
                  </span>
                </div>
              </div>
              {doc.terms ? <p className="whitespace-pre-wrap text-xs text-text-muted">{doc.terms}</p> : null}
            </div>
          )}
        </RelatedListCard>

        {type === "invoice" ? (
          <RelatedListCard id="payments" title="Payments" count={doc.payments.length}>
            <div className="space-y-3">
              <div className="flex gap-6 text-[13px]">
                <span>
                  Paid <strong className="tabular-nums">{money(doc.amountPaid ?? 0, doc.currency)}</strong>
                </span>
                <span>
                  Balance <strong className="tabular-nums" data-testid="invoice-balance">{money(balance, doc.currency)}</strong>
                </span>
              </div>
              <ul className="divide-y divide-border text-[13px]" data-testid="payments-list">
                {doc.payments.map((p) => (
                  <li key={p.id} className="flex gap-3 py-1.5">
                    <span className="w-28">{formatDate(p.receivedAt, prefs.dateFormat)}</span>
                    <span className="w-24">{p.method.charAt(0) + p.method.slice(1).toLowerCase()}</span>
                    <span className="flex-1 text-text-muted">{p.reference ?? ""}</span>
                    <span className="tabular-nums">{money(p.amount, doc.currency)}</span>
                  </li>
                ))}
                {doc.payments.length === 0 ? <li className="py-1 text-text-muted">No payments recorded.</li> : null}
              </ul>
              {canEdit && ["ISSUED", "PART_PAID"].includes(doc.status) ? <PaymentForm invoiceId={doc.id} balance={Math.round(balance * 100) / 100} /> : null}
              <PaymentLinks ctx={ctx} invoiceId={doc.id} brandId={doc.brandId} canCreate={canEdit && ["ISSUED", "PART_PAID"].includes(doc.status)} balance={Math.round(balance * 100) / 100} />
            </div>
          </RelatedListCard>
        ) : null}
      </div>
    </div>
  );
}
