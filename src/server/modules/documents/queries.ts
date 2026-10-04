import "server-only";
import { assertCan, hasPermission } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { DOCS, type DocConfig, type DocType } from "./config";

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
}

export interface DocRow {
  id: string;
  type: DocType;
  number: string;
  status: string;
  dealId: string;
  dealName: string;
  accountId: string | null;
  customerName: string | null;
  contactId: string | null;
  issueDate: string;
  /** validUntil / expectedDelivery / dueDate */
  date: string | null;
  currency: string;
  headerDiscountPct: number;
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
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  ...(cfg.type === "invoice" ? { amountPaid: true } : {}),
  terms: true,
  notes: true,
  priceBookId: true,
  sourceDocumentId: true,
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
    dealId: d.dealId,
    dealName: d.deal.name,
    accountId: d.accountId,
    customerName: d.deal.account?.name ?? d.deal.customerName ?? null,
    contactId: d.contactId,
    issueDate: day(d.issueDate)!,
    date: day(d[cfg.dateField]),
    currency: d.currency,
    headerDiscountPct: num(d.headerDiscountPct) ?? 0,
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
  };
}

const delegate = (ctx: AccessContext, cfg: DocConfig) => (scopedDb(ctx) as any)[cfg.type];

export async function listDocuments(
  ctx: AccessContext,
  type: DocType,
  filters: UiFilters = {},
  opts: { q?: string; status?: string; dealId?: string; mine?: boolean; take?: number; skip?: number } = {},
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
      q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { deal: { name: { contains: q, mode: "insensitive" } } }, { deal: { customerName: { contains: q, mode: "insensitive" } } }] } : {},
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
