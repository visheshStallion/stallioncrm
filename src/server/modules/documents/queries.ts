import "server-only";
import { assertCan, hasPermission } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { DOCS, type DocConfig, type DocType, type Party } from "./config";

/* eslint-disable @typescript-eslint/no-explicit-any -- the three document models share one implementation */

const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

export interface DocLine {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  lineTotal: number;
  vin: string | null;
  itemCode: string | null;
  details: string | null;
  uom: string | null;
  isStockItem: boolean;
  // ── Ordered Items (prompt 24) ──
  amount: number;
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
  discountAmount: number;
  taxes: Array<{ name: string; rate: number; amount: number }>;
  taxAmount: number;
  total: number;
  vins: string[];
  needsApproval: boolean;
  invoicedQty: number;
  sourceLineId: string | null;
}

export interface DocRow {
  id: string;
  type: DocType;
  number: string;
  status: string;
  /** optional (prompt 23): a document can be created standalone */
  dealId: string | null;
  dealName: string | null;
  accountId: string | null;
  /** the bill-to name of the snapshot, else the linked account / deal customer */
  customerName: string | null;
  billTo: Partial<Party> | null;
  shipTo: Partial<Party> | null;
  /** Linked when the document has a deal, an account, a contact or a source document */
  linkStatus: "Linked" | "Unlinked";
  contactId: string | null;
  issueDate: string;
  /** validUntil / expectedDelivery / dueDate */
  date: string | null;
  currency: string;
  headerDiscountPct: number;
  headerDiscountType: "PERCENT" | "AMOUNT";
  headerDiscountValue: number;
  documentTaxes: Array<{ name: string; rate: number; amount: number }>;
  adjustment: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number | null;
  terms: string | null;
  notes: string | null;
  priceBookId: string | null;
  sourceDocumentId: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  /** Create Invoice page fields (prompt 26) – invoices only */
  invoice: InvoiceExtra | null;
  /** Create Quote page fields – quotes only */
  quote: QuoteExtra | null;
  /** Create Sales Order page fields – sales orders only */
  order: OrderExtra | null;
}

export interface OrderExtra {
  subject: string | null;
  customerPoRef: string | null;
  customerNo: string | null;
  pending: string | null;
  carrier: string | null;
  dueDate: string | null;
  phone: string | null;
  tinNumber: string | null;
  exchangeRate: number;
  exciseDuty: number;
  otherCharges: number;
  salesCommission: number;
  formViewId: string | null;
}

export interface QuoteExtra {
  subject: string | null;
  orgName: string | null;
  orgAddress: string | null;
  orgCity: string | null;
  orgCountry: string | null;
  tinNumber: string | null;
  phone: string | null;
  email: string | null;
  exchangeRate: number;
  formViewId: string | null;
}

export interface InvoiceExtra {
  subject: string | null;
  customerPoRef: string | null;
  tinNumber: string | null;
  phone: string | null;
  exchangeRate: number;
  exciseDuty: number;
  otherCharges: number;
  salesCommission: number;
  creditedAmount: number;
  balanceDue: number;
  issuedAt: string | null;
  voidReason: string | null;
  formViewId: string | null;
  sentAt: string | null;
}

const headerSelect = (cfg: DocConfig) => ({
  id: true,
  number: true,
  status: true,
  dealId: true,
  deal: { select: { name: true, customerName: true, account: { select: { name: true } } } },
  accountId: true,
  contactId: true,
  issueDate: true,
  [cfg.dateField]: true,
  currency: true,
  headerDiscountPct: true,
  headerDiscountType: true,
  headerDiscountValue: true,
  documentTaxes: true,
  adjustment: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  ...(cfg.type === "salesOrder" ? { subject: true, customerPoRef: true, customerNo: true, pending: true, carrier: true, dueDate: true, phone: true, tinNumber: true, exchangeRate: true, exciseDuty: true, otherCharges: true, salesCommission: true, formViewId: true } : {}),
  ...(cfg.type === "quote" ? { subject: true, orgName: true, orgAddress: true, orgCity: true, orgCountry: true, tinNumber: true, phone: true, email: true, exchangeRate: true, formViewId: true } : {}),
  ...(cfg.type === "invoice" ? { amountPaid: true, subject: true, customerPoRef: true, tinNumber: true, phone: true, exchangeRate: true, exciseDuty: true, otherCharges: true, salesCommission: true, creditedAmount: true, issuedAt: true, voidReason: true, formViewId: true, sentAt: true } : {}),
  terms: true,
  notes: true,
  priceBookId: true,
  sourceDocumentId: true,
  billTo: true,
  shipTo: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  owner: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
});

function toRow(cfg: DocConfig, d: any): DocRow {
  return {
    id: d.id,
    type: cfg.type,
    number: d.number,
    status: d.status,
    dealId: d.dealId ?? null,
    dealName: d.deal?.name ?? null,
    accountId: d.accountId,
    customerName: (d.billTo as Partial<Party> | null)?.name ?? d.deal?.account?.name ?? d.deal?.customerName ?? null,
    billTo: (d.billTo as Partial<Party> | null) ?? null,
    shipTo: (d.shipTo as Partial<Party> | null) ?? null,
    linkStatus: d.dealId || d.accountId || d.contactId || d.sourceDocumentId ? "Linked" : "Unlinked",
    contactId: d.contactId,
    issueDate: day(d.issueDate)!,
    date: day(d[cfg.dateField]),
    currency: d.currency,
    headerDiscountPct: num(d.headerDiscountPct) ?? 0,
    headerDiscountType: d.headerDiscountType === "AMOUNT" ? "AMOUNT" : "PERCENT",
    headerDiscountValue: num(d.headerDiscountValue) ?? 0,
    documentTaxes: Array.isArray(d.documentTaxes) ? d.documentTaxes : [],
    adjustment: num(d.adjustment) ?? 0,
    subtotal: num(d.subtotal) ?? 0,
    discountTotal: num(d.discountTotal) ?? 0,
    taxTotal: num(d.taxTotal) ?? 0,
    total: num(d.total) ?? 0,
    amountPaid: cfg.type === "invoice" ? num(d.amountPaid) ?? 0 : null,
    terms: d.terms,
    notes: d.notes,
    priceBookId: d.priceBookId,
    sourceDocumentId: d.sourceDocumentId,
    brandId: d.brandId,
    regionId: d.regionId,
    ownerId: d.ownerId,
    ownerName: d.owner.name,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    order:
      cfg.type === "salesOrder"
        ? { subject: d.subject ?? null, customerPoRef: d.customerPoRef ?? null, customerNo: d.customerNo ?? null, pending: d.pending ?? null, carrier: d.carrier ?? null, dueDate: day(d.dueDate), phone: d.phone ?? null, tinNumber: d.tinNumber ?? null, exchangeRate: num(d.exchangeRate) ?? 1, exciseDuty: num(d.exciseDuty) ?? 0, otherCharges: num(d.otherCharges) ?? 0, salesCommission: num(d.salesCommission) ?? 0, formViewId: d.formViewId ?? null }
        : null,
    quote:
      cfg.type === "quote"
        ? { subject: d.subject ?? null, orgName: d.orgName ?? null, orgAddress: d.orgAddress ?? null, orgCity: d.orgCity ?? null, orgCountry: d.orgCountry ?? null, tinNumber: d.tinNumber ?? null, phone: d.phone ?? null, email: d.email ?? null, exchangeRate: num(d.exchangeRate) ?? 1, formViewId: d.formViewId ?? null }
        : null,
    invoice:
      cfg.type === "invoice"
        ? {
            subject: d.subject ?? null,
            customerPoRef: d.customerPoRef ?? null,
            tinNumber: d.tinNumber ?? null,
            phone: d.phone ?? null,
            exchangeRate: num(d.exchangeRate) ?? 1,
            exciseDuty: num(d.exciseDuty) ?? 0,
            otherCharges: num(d.otherCharges) ?? 0,
            salesCommission: num(d.salesCommission) ?? 0,
            creditedAmount: num(d.creditedAmount) ?? 0,
            balanceDue: Math.round(((num(d.total) ?? 0) - (num(d.amountPaid) ?? 0) - (num(d.creditedAmount) ?? 0)) * 100) / 100,
            issuedAt: d.issuedAt ? d.issuedAt.toISOString() : null,
            voidReason: d.voidReason ?? null,
            formViewId: d.formViewId ?? null,
            sentAt: d.sentAt ? d.sentAt.toISOString() : null,
          }
        : null,
  };
}

const delegate = (ctx: AccessContext, cfg: DocConfig) => (scopedDb(ctx) as any)[cfg.type];

export async function listDocuments(
  ctx: AccessContext,
  type: DocType,
  filters: UiFilters = {},
  opts: { q?: string; status?: string; dealId?: string; mine?: boolean; linked?: "Linked" | "Unlinked"; take?: number; skip?: number } = {},
): Promise<{ rows: DocRow[]; total: number }> {
  const cfg = DOCS[type];
  assertCan(ctx, cfg.module, "read");
  const q = opts.q?.trim();
  const where = {
    AND: [
      filterWhere(ctx, filters),
      opts.status && opts.status in cfg.statuses ? { status: opts.status } : {},
      opts.dealId ? { dealId: opts.dealId } : {},
      opts.mine ? { ownerId: ctx.userId } : {},
      opts.linked === "Unlinked" ? { dealId: null, accountId: null, contactId: null, sourceDocumentId: null } : opts.linked === "Linked" ? { OR: [{ dealId: { not: null } }, { accountId: { not: null } }, { contactId: { not: null } }, { sourceDocumentId: { not: null } }] } : {},
      q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { deal: { name: { contains: q, mode: "insensitive" } } },
              { deal: { customerName: { contains: q, mode: "insensitive" } } },
              { billTo: { path: ["name"], string_contains: q } },
              { billTo: { path: ["phone"], string_contains: q.replace(/\s/g, "") } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    delegate(ctx, cfg).findMany({ where, select: headerSelect(cfg), orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: Math.min(opts.take ?? 20, 1000), skip: opts.skip ?? 0 }),
    delegate(ctx, cfg).count({ where }),
  ]);
  return { rows: rows.map((r: any) => toRow(cfg, r)), total };
}

export interface DocDetail extends DocRow {
  lines: DocLine[];
  payments: Array<{ id: string; amount: number; method: string; reference: string | null; receivedAt: string }>;
}

/** 404 for missing AND out-of-scope documents. */
export async function getDocument(ctx: AccessContext, type: DocType, id: string): Promise<DocDetail> {
  const cfg = DOCS[type];
  assertCan(ctx, cfg.module, "read");
  const db = scopedDb(ctx);
  const d = await delegate(ctx, cfg).findUnique({ where: { id }, select: headerSelect(cfg) });
  if (!d) throw new NotFoundError();
  const [lines, payments] = await Promise.all([
    db.documentLine.findMany({ where: { [cfg.lineKey]: id }, orderBy: { position: "asc" } }),
    type === "invoice" ? db.payment.findMany({ where: { invoiceId: id }, orderBy: { receivedAt: "asc" } }) : Promise.resolve([]),
  ]);
  return {
    ...toRow(cfg, d),
    lines: lines.map((l) => ({
      id: l.id,
      position: l.position,
      productId: l.productId,
      description: l.description,
      qty: Number(l.qty.toString()),
      unitPrice: Number(l.unitPrice.toString()),
      discountPct: Number(l.discountPct.toString()),
      taxRate: Number(l.taxRate.toString()),
      lineTotal: Number(l.lineTotal.toString()),
      vin: l.vin,
      itemCode: l.itemCode,
      details: l.details,
      uom: l.uom,
      isStockItem: l.isStockItem,
      amount: Number(l.amount.toString()),
      discountType: l.discountType === "AMOUNT" ? "AMOUNT" : "PERCENT",
      discountValue: Number(l.discountValue.toString()),
      discountAmount: Number(l.discountAmount.toString()),
      taxes: Array.isArray(l.taxes) ? (l.taxes as Array<{ name: string; rate: number; amount: number }>) : [],
      taxAmount: Number(l.taxAmount.toString()),
      total: Number(l.total.toString()),
      vins: Array.isArray(l.vins) ? (l.vins as string[]) : l.vin ? [l.vin] : [],
      needsApproval: l.needsApproval,
      invoicedQty: Number(l.invoicedQty.toString()),
      sourceLineId: l.sourceLineId,
    })),
    payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount.toString()), method: p.method, reference: p.reference, receivedAt: p.receivedAt.toISOString() })),
  };
}

/** Documents of a deal for related lists (each type only if the profile can read it). */
export async function dealDocuments(ctx: AccessContext, dealId: string) {
  const out: Array<Pick<DocRow, "id" | "type" | "number" | "status" | "total" | "issueDate">> = [];
  for (const cfg of Object.values(DOCS)) {
    if (!hasPermission(ctx, cfg.module, "read")) continue;
    const { rows } = await listDocuments(ctx, cfg.type, {}, { dealId, take: 50 });
    out.push(...rows.map((r) => ({ id: r.id, type: r.type, number: r.number, status: r.status, total: r.total, issueDate: r.issueDate })));
  }
  return out;
}

/** The pending approval request of a document, if any (visible to requester, approver's territory and management). */
export async function pendingApproval(ctx: AccessContext, entity: string, entityId: string) {
  const a = await scopedDb(ctx).approvalRequest.findFirst({
    where: { entity, entityId, status: "PENDING" },
    select: { id: true, level: true, reason: true, approverId: true, approver: { select: { name: true } }, owner: { select: { name: true } }, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return a ? { id: a.id, level: a.level, reason: a.reason, approverId: a.approverId, approverName: a.approver?.name ?? null, requestedBy: a.owner.name, at: a.createdAt.toISOString() } : null;
}
