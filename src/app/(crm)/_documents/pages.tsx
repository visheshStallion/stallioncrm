import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { CreateSplitButton, ModuleListFrame, Pagination, ViewSelector } from "@/components/crm/ListPage";
import { ApprovalBanner, EmptyState, PageTitleRow, StatusPill, type Tone } from "@/components/crm/primitives";
import { Field, FieldSection, RecordHeader, RelatedListCard } from "@/components/crm/record";
import { PaymentLinks } from "@/components/crm/PaymentLinks";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { fieldMaskView } from "@/server/access/field-mask";
import { scopedDb } from "@/server/db";
import { parsePaging } from "@/server/list/filters";
import { DOCS, type DocType } from "@/server/modules/documents/config";
import { getDocument, listDocuments, pendingApproval } from "@/server/modules/documents/queries";
import { expireQuotes } from "@/server/modules/documents/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { ApprovalDecision, CreditNoteButton, DocButtons, PaymentForm, type DocButton } from "./DocActions";
import { gridFromLines } from "@/components/crm/line-grid";
import { DocumentLines, OrderTools } from "./DocumentLines";
import { LinkPanel } from "./LinkPanel";
import { NewDocumentForm, type NewDocumentProps } from "./NewDocumentForm";

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
  OVERDUE: "danger",
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
    linked: view === "unlinked" ? "Unlinked" : view === "linked" ? "Linked" : undefined,
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
            { id: "unlinked", name: `Unlinked ${cfg.plural}`, group: "system" },
            { id: "linked", name: `Linked ${cfg.plural}`, group: "system" },
            ...Object.entries(cfg.statuses).map(([id, name]) => ({ id, name: `${name} ${cfg.plural}`, group: "system" as const })),
          ]}
        />
      }
      actions={
        <div className="flex gap-2">
        {hasPermission(ctx, cfg.module, "create") ? <CreateSplitButton label={`Create ${cfg.label}`} href={`${cfg.path}/new`} templateModule={cfg.module} /> : null}
        <form className="flex gap-2">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={one(sp.q)} placeholder="Number, deal or customer" className="h-9 w-60" aria-label={`Search ${cfg.plural}`} data-shortcut="filter" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        </div>
      }
    >
      <div className="overflow-auto rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            title={`No ${cfg.plural.toLowerCase()} in this view`}
            text={`Create a ${cfg.label.toLowerCase()} directly with “Create ${cfg.label}”, or convert it from ${type === "quote" ? "a deal" : type === "salesOrder" ? "an accepted quote" : "a quote or sales order"}.`}
          />
        ) : (
          <table className="crm-table w-full">
            <thead className="bg-muted text-left text-[12px] text-text-muted">
              <tr>
                {["Number", "Brand", "Customer", "Deal", "Links", "Status", "Issue date", cfg.dateLabel, "Total", "Owner"].map((h) => (
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
                    {r.dealId ? (
                      <Link href={`/deals/${r.dealId}`} className="hover:underline">
                        {r.dealName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3">
                    <StatusPill tone={r.linkStatus === "Linked" ? "neutral" : "warning"}>{r.linkStatus}</StatusPill>
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

const canIssueAny = (ctx: Awaited<ReturnType<typeof requireContext>>) => !!ctx.isAdmin || hasPermission(ctx, "invoices", "approve") || hasPermission(ctx, "inventoryFinance", "approve");

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
    ...(["DRAFT", "APPROVED"].includes(status) ? [{ op: "issue", label: "Issue", variant: "default" as const }] : []),
    ...(status === "PENDING_APPROVAL" ? [{ op: "approve", label: "Approve", variant: "default" as const }, { op: "sendBack", label: "Send back", ask: "Why is the invoice sent back?" }] : []),
    ...(["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "SENT", "OVERDUE"].includes(status) ? [{ op: "void", label: "Void", ask: "Why is this invoice voided? (required – it is recorded)" }] : []),
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
  const doc = fieldMaskView(
    ctx,
    DOCS[type].module,
    await getDocument(ctx, type, id).catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    }),
  );
  const [dir, prefs, brandCfg, approval] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { legalEntity: true, discountApprovalPct: true, status: true } }),
    type === "quote" ? pendingApproval(ctx, "Quote", id) : Promise.resolve(null),
  ]);
  const brand = dir.brands.find((b) => b.id === doc.brandId);
  const region = dir.regions.find((r) => r.id === doc.regionId);
  const canEdit = can(ctx, cfg.module, "edit", doc) && brandCfg.status !== "INACTIVE";
  // invoices are edited on the Create Invoice page (prompt 26) – its charges and header fields live there
  const editable = canEdit && cfg.editable.includes(doc.status) && type !== "invoice";
  const { canIssueInvoices } = await import("@/server/modules/documents/service");
  const issuer = type === "invoice" && canIssueInvoices(ctx);
  const inv = doc.invoice;
  const creditNotes = type === "invoice" ? await scopedDb(ctx).creditNote.findMany({ where: { invoiceId: doc.id }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, amount: true, reason: true, createdAt: true } }) : [];
  const invRules = type === "invoice" ? (await import("@/server/modules/documents/config")).parseRules((await scopedDb(ctx).brand.findUnique({ where: { id: doc.brandId }, select: { documentRules: true } }))?.documentRules) : null;
  const nextModule = type === "quote" ? "salesOrders" : "invoices";
  const buttons = buttonsFor(type, doc.status, canEdit || (type === "invoice" && canIssueAny(ctx)), can(ctx, nextModule, "create", doc));

  const { gridSettings } = await import("@/server/modules/documents/lookups");
  const settings = await gridSettings(ctx, doc.brandId);
  const { managedBrands } = await import("@/server/access/brand-tag");
  const canDecide = !!approval && (approval.approverId === ctx.userId || (ctx.scope === "ALL" && hasPermission(ctx, "quotes", "approve")));
  const balance = type === "invoice" ? (inv?.balanceDue ?? doc.total - (doc.amountPaid ?? 0)) : 0;
  const payable = ["ISSUED", "SENT", "PART_PAID", "OVERDUE"].includes(doc.status) && (canEdit || issuer);

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
            {type === "invoice" && doc.status === "DRAFT" && canEdit ? (
              <Button asChild variant="outline">
                <Link href={`/invoices/${doc.id}/edit`} data-testid="inv-edit">
                  Edit
                </Link>
              </Button>
            ) : null}
            {type === "invoice" && can(ctx, "invoices", "create", doc) ? (
              <Button asChild variant="outline">
                <Link href={`/invoices/new?clone=${doc.id}`} data-testid="inv-clone">
                  Clone
                </Link>
              </Button>
            ) : null}
            <DocButtons type={type} id={doc.id} buttons={buttons} />
            {issuer && ["ISSUED", "SENT", "PART_PAID", "PAID", "OVERDUE"].includes(doc.status) && doc.total - (inv?.creditedAmount ?? 0) > 0.005 ? <CreditNoteButton invoiceId={doc.id} max={Math.round((doc.total - (inv?.creditedAmount ?? 0)) * 100) / 100} /> : null}
            {type === "salesOrder" ? (
              <OrderTools
                id={doc.id}
                status={doc.status}
                canEdit={canEdit}
                canReopen={canEdit && (ctx.isAdmin || managedBrands(ctx).includes(doc.brandId))}
                canInvoice={can(ctx, "invoices", "create", doc)}
                needsApproval={doc.lines.some((l) => l.needsApproval)}
                lines={doc.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, invoicedQty: l.invoicedQty, vins: l.vins, isStockItem: l.isStockItem }))}
              />
            ) : null}
            {canEdit ? (
              <LinkPanel
                type={type}
                id={doc.id}
                brandId={doc.brandId}
                status={doc.status}
                links={{ dealId: doc.dealId, accountId: doc.accountId, contactId: doc.contactId, sourceDocumentId: doc.sourceDocumentId }}
                canCreateCustomer={!doc.accountId && !!doc.billTo?.name && hasPermission(ctx, "accounts", "create")}
                canCreateDeal={type === "quote" && !doc.dealId && hasPermission(ctx, "deals", "create")}
                canInvoiceQuote={type === "quote" && doc.status === "ACCEPTED" && can(ctx, "invoices", "create", doc)}
              />
            ) : null}
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
          <Field
            label="Bill to"
            value={
              <span className="whitespace-pre-line" data-testid="doc-bill-to">
                {[doc.billTo?.company && doc.billTo.company !== doc.billTo.name ? doc.billTo.company : null, doc.billTo?.address, [doc.billTo?.city, doc.billTo?.state].filter(Boolean).join(", "), [doc.billTo?.phone, doc.billTo?.email].filter(Boolean).join(" · "), doc.billTo?.taxId ? `TIN ${doc.billTo.taxId}` : null].filter(Boolean).join("\n") || "—"}
              </span>
            }
          />
          <Field label="Deal" value={doc.dealId ? <Link href={`/deals/${doc.dealId}`} className="text-primary hover:underline">{doc.dealName}</Link> : "—"} />
          <Field label="Links" value={<StatusPill tone={doc.linkStatus === "Linked" ? "neutral" : "warning"}>{doc.linkStatus}</StatusPill>} />
          {doc.sourceDocumentId ? <Field label="Created from" value={<SourceLink id={doc.sourceDocumentId} />} /> : null}
          <Field label="Region" value={<RegionBadge region={region} />} />
          <Field label={type === "invoice" ? "Invoice Date" : "Issue date"} value={formatDate(doc.issueDate, prefs.dateFormat)} />
          <Field label={cfg.dateLabel} value={formatDate(doc.date, prefs.dateFormat)} />
          {inv ? (
            <>
              <Field label="Subject" value={inv.subject ?? "—"} />
              <Field label="Purchase Order" value={inv.customerPoRef ?? "—"} />
              <Field label="TIN Number" value={inv.tinNumber ?? "—"} />
              <Field label="Phone Number" value={inv.phone ?? "—"} />
              <Field label="Currency" value={doc.currency === "NGN" ? "NGN" : `${doc.currency} · ₦ ${inv.exchangeRate} per ${doc.currency}`} />
              {inv.otherCharges > 0 ? <Field label="Other Charges" value={money(inv.otherCharges, doc.currency)} /> : null}
              {inv.exciseDuty > 0 ? <Field label="Excise Duty" value={money(inv.exciseDuty, doc.currency)} /> : null}
              {inv.salesCommission > 0 ? <Field label="Sales Commission" value={money(inv.salesCommission, "NGN")} /> : null}
              {inv.issuedAt ? <Field label="Issued" value={formatDateTime(inv.issuedAt, prefs.dateFormat)} /> : null}
              {inv.voidReason ? <Field label="Void reason" value={<span data-testid="void-reason">{inv.voidReason}</span>} /> : null}
            </>
          ) : null}
        </FieldSection>

        <RelatedListCard id="lines" title="Line items" count={doc.lines.length}>
          <DocumentLines
            type={type}
            id={doc.id}
            brandId={doc.brandId}
            currency={doc.currency}
            editable={editable}
            initial={gridFromLines(doc.lines, doc)}
            header={{ date: doc.date, terms: doc.terms, notes: doc.notes }}
            dateLabel={cfg.dateLabel}
            settings={settings}
            extraRows={
              inv
                ? [
                    ...(inv.otherCharges > 0 ? [{ label: "Other Charges", amount: inv.otherCharges, inTotal: true, testId: "total-other-charges" }] : []),
                    ...(inv.exciseDuty > 0 ? [{ label: "Excise Duty", amount: inv.exciseDuty, inTotal: !!invRules?.exciseInTotal, testId: "total-excise" }] : []),
                  ]
                : undefined
            }
            afterTotals={
              inv && doc.status !== "DRAFT"
                ? [
                    { label: "Amount Paid", amount: doc.amountPaid ?? 0, testId: "total-paid" },
                    ...(inv.creditedAmount > 0 ? [{ label: "Credited", amount: inv.creditedAmount, testId: "total-credited" }] : []),
                    { label: "Balance Due", amount: balance, testId: "total-balance", strong: true },
                  ]
                : undefined
            }
          />
        </RelatedListCard>

        {type === "invoice" ? (
          <RelatedListCard id="payments" title="Payments" count={doc.payments.length}>
            <div className="space-y-3">
              <div className="flex gap-6 text-[13px]">
                <span>
                  Paid <strong className="tabular-nums">{money(doc.amountPaid ?? 0, doc.currency)}</strong>
                </span>
                {inv && inv.creditedAmount > 0 ? (
                  <span>
                    Credited <strong className="tabular-nums">{money(inv.creditedAmount, doc.currency)}</strong>
                  </span>
                ) : null}
                <span>
                  Balance <strong className="tabular-nums" data-testid="invoice-balance">{money(balance, doc.currency)}</strong>
                </span>
              </div>
              {creditNotes.length ? (
                <ul className="divide-y divide-border text-[13px]" data-testid="credit-notes">
                  {creditNotes.map((c) => (
                    <li key={c.id} className="flex gap-3 py-1.5">
                      <span className="w-40 font-medium">{c.number}</span>
                      <span className="w-28">{formatDate(c.createdAt.toISOString(), prefs.dateFormat)}</span>
                      <span className="flex-1 text-text-muted">{c.reason}</span>
                      <span className="tabular-nums">−{money(Number(c.amount), doc.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
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
              {payable ? <PaymentForm invoiceId={doc.id} balance={Math.round(balance * 100) / 100} /> : null}
              <PaymentLinks ctx={ctx} invoiceId={doc.id} brandId={doc.brandId} canCreate={payable} balance={Math.round(balance * 100) / 100} />
            </div>
          </RelatedListCard>
        ) : null}
      </div>
    </div>
  );
}

/** Standalone create page shared by quotes, sales orders and invoices (prompt 23): /quotes/new, … `?template=` pre-fills. */
export async function NewDocumentPage({ type, searchParams }: { type: DocType; searchParams: Promise<SP> }) {
  const cfg = DOCS[type];
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, cfg.module, "create")) forbidden();
  const { leadFormLookups } = await import("@/server/modules/leads/queries");
  const lookups = await leadFormLookups(ctx);
  let initial: NewDocumentProps["initial"] = {};
  const templateId = one(sp.template);
  if (templateId) {
    const { resolveForUse } = await import("@/server/modules/rectpl/service");
    const t = await resolveForUse(ctx, templateId, cfg.module).catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    });
    const products = t.lineItems.length ? await scopedDb(ctx).product.findMany({ where: { id: { in: t.lineItems.map((l) => l.productId) } }, select: { id: true, name: true, category: true } }) : [];
    initial = {
      templateId: t.id,
      templateName: t.name,
      brandId: t.brandId,
      terms: (t.values.terms as string | undefined) ?? null,
      notes: (t.values.notes as string | undefined) ?? null,
      headerDiscountPct: typeof t.values.headerDiscountPct === "number" ? t.values.headerDiscountPct : null,
      lines: t.lineItems
        .map((l) => ({ l, p: products.find((x) => x.id === l.productId) }))
        .filter((x) => x.p)
        .map(({ l, p }) => ({ productId: p!.id, description: p!.name, qty: String(l.qty), discountPct: String(l.discountPct), isStockItem: p!.category === "VEHICLE" })),
    };
  }
  // pre-links from another page: /invoices/new?dealId=…
  const dealId = one(sp.dealId);
  if (dealId) {
    const d = await scopedDb(ctx).deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, brandId: true, customerName: true } });
    if (d) initial = { ...initial, brandId: d.brandId, links: { dealId: { id: d.id, label: d.name } }, billTo: { name: d.customerName ?? "" } };
  }
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitleRow title={`Create ${cfg.label}`} left={<Link href={cfg.path} className="text-sm text-primary hover:underline">← {cfg.plural}</Link>} />
      <NewDocumentForm type={type} label={cfg.label} path={cfg.path} dateLabel={cfg.dateLabel} brands={lookups.brands} regions={lookups.regions} defaultBrandId={lookups.defaultBrandId} defaultRegionId={lookups.defaultRegionId} initial={initial} showVin={type !== "quote"} />
    </div>
  );
}

/** The document a document was converted from (quote or sales order), if the viewer can open it. */
async function SourceLink({ id }: { id: string }) {
  const ctx = await requireContext();
  const db = scopedDb(ctx);
  const [q, o] = await Promise.all([db.quote.findUnique({ where: { id }, select: { number: true } }), db.salesOrder.findUnique({ where: { id }, select: { number: true } })]);
  if (q) return <Link href={`/quotes/${id}`} className="text-primary hover:underline">{q.number}</Link>;
  if (o) return <Link href={`/salesOrders/${id}`} className="text-primary hover:underline">{o.number}</Link>;
  return <span>—</span>;
}
