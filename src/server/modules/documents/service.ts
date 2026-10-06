import "server-only";
import { assertSameBrand, managedBrands } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { cancelPendingApprovals } from "@/server/db/approval-engine";
import { BadRequestError } from "@/server/errors";
import * as posting from "@/server/db/inventory-posting";
import { emitEvent } from "@/server/events";
import { dispatchEvent } from "@/server/integrations/events";
import { getPrice } from "@/server/modules/catalogue/queries";
import { defaultBookFor } from "@/server/modules/catalogue/pricing";
import { getDeal } from "@/server/modules/deals/queries";
import { decide, submitForApproval } from "@/server/modules/approvals/service";
import { advanceDealToStage } from "@/server/modules/deals/service";
import { notify } from "@/server/modules/notifications/service";
import { DOCS, ISSUED_INVOICE, PAYABLE_INVOICE, createSchema, linkSchema, parseRules, paymentSchema, saveSchema, type CreateDocumentInput, type DocConfig, type DocType, type DocumentRules, type LineData, type LinkInput, type Party, type SaveInput } from "./config";
import { getDocument, type DocDetail } from "./queries";
import { assertVins, computeLines, normaliseLine, persistLines, type HeaderInput } from "./lines";
import { discountApproval, paymentStatus, type ApprovalDecision } from "./totals";

/* eslint-disable @typescript-eslint/no-explicit-any -- the three document models share one implementation */

const delegate = (ctx: AccessContext, cfg: DocConfig) => (scopedDb(ctx) as any)[cfg.type];
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function load(ctx: AccessContext, type: DocType, id: string, action: "edit" | "approve" = "edit") {
  const doc = await getDocument(ctx, type, id); // 404 when hidden
  if (action === "edit") assertCan(ctx, DOCS[type].module, "edit", doc);
  return doc;
}

async function setStatus(ctx: AccessContext, type: DocType, id: string, status: string, extra: Record<string, unknown> = {}) {
  await delegate(ctx, DOCS[type]).update({ where: { id }, data: { status, ...extra }, select: { id: true } });
}

/** Every product on a document must be a product of the document's brand (lookup-filter enforcement). */
async function assertLineProducts(ctx: AccessContext, brandId: string, lines: LineData[]) {
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const products = await scopedDb(ctx).product.findMany({ where: { id: { in: ids } }, select: { id: true, brandId: true } });
  for (const id of ids) assertSameBrand(brandId, products.find((p) => p.id === id)?.brandId);
}

/**
 * The one way lines are written (prompt 24): normalised, VINs checked, every figure computed on the server with the
 * brand's tax mode and rounding, lines and header totals saved. Returns the computed document.
 */
async function applyLines(ctx: AccessContext, type: DocType, docId: string, brandId: string, priceBookId: string | null, raw: LineData[], header: HeaderInput, extra: Record<string, unknown> = {}, opts: { history?: boolean } = {}) {
  const rules = await rulesOf(ctx, brandId);
  const lines = raw.map((l) => normaliseLine(l, rules));
  await assertVins(ctx, type, docId, brandId, lines);
  const r = await computeLines(ctx, brandId, priceBookId, lines, header, rules);
  await persistLines(ctx, type, docId, brandId, lines, r, header, extra, opts);
  return r;
}

// ───────────────────────────── create / edit ─────────────────────────────

/** New draft quote for a deal: brand, region, customer and owner come from the deal; first line from its model. */
export async function createQuoteFromDeal(ctx: AccessContext, dealId: string) {
  const deal = await getDeal(ctx, dealId);
  assertCan(ctx, "quotes", "create", deal);
  if (deal.stageType !== "OPEN") throw new BadRequestError("Quotes can only be created for open deals");
  const db = scopedDb(ctx);
  const [brand, books] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: deal.brandId }, select: { documentTerms: true } }),
    db.priceBook.findMany({ where: { brandId: deal.brandId, active: true } }),
  ]);
  const book = defaultBookFor(books, deal.brandId, new Date());
  const lines: LineData[] = [];
  if (deal.modelId) {
    const price = await getPrice(ctx, deal.modelId, new Date(), book?.id);
    lines.push({
      productId: deal.modelId,
      description: [deal.modelName, deal.colour].filter(Boolean).join(" – "),
      qty: deal.quantity,
      unitPrice: price.price ?? 0,
      discountPct: deal.discountPct ?? 0,
      taxRate: price.taxRatePct,
      vin: null,
      itemCode: null,
      details: null,
      uom: null,
      isStockItem: true,
    });
  }
  const billTo = await snapshotFrom(ctx, deal.accountId, deal.contactId, deal.customerName);
  const quote = await db.quote.create({
    data: {
      dealId,
      billTo: (billTo as object) ?? undefined,
      accountId: deal.accountId,
      contactId: deal.contactId,
      brandId: deal.brandId,
      regionId: deal.regionId,
      ownerId: deal.ownerId,
      currency: deal.currency,
      validUntil: addDays(14),
      terms: brand.documentTerms,
      priceBookId: book?.id ?? null,
    },
    select: { id: true },
  });
  await applyLines(ctx, "quote", quote.id, deal.brandId, book?.id ?? null, lines, {}, {}, { history: false });
  return quote;
}

/** Saves lines and header of a DRAFT document. Totals are computed here – never taken from the client. */
export async function saveDocument(ctx: AccessContext, type: DocType, id: string, input: SaveInput) {
  const cfg = DOCS[type];
  const doc = await load(ctx, type, id);
  if (!cfg.editable.includes(doc.status)) throw new ForbiddenError(`A ${cfg.label.toLowerCase()} can only be edited while it is a draft`);
  const data = saveSchema.parse(input);
  await assertLineProducts(ctx, doc.brandId, data.lines);
  if (data.priceBookId) {
    const book = await scopedDb(ctx).priceBook.findUnique({ where: { id: data.priceBookId }, select: { brandId: true } });
    assertSameBrand(doc.brandId, book?.brandId, "The price book");
  }
  if ((data.adjustment ?? 0) !== 0 && (data.adjustment ?? 0) !== doc.adjustment) await assertAdjustment(ctx, doc.brandId);
  const r = await applyLines(ctx, type, id, doc.brandId, data.priceBookId, data.lines, data, { [cfg.dateField]: data.date, terms: data.terms, notes: data.notes, priceBookId: data.priceBookId });
  return { id, subtotal: r.gross, discountTotal: r.discountTotal, taxTotal: r.taxTotal, total: r.grandTotal, lineTotals: r.lines.map((l) => l.net), grid: r };
}

// ───────────────────────────── quotes: approval & lifecycle ─────────────────────────────

/** Evaluates the discount rule for a quote against the price book maxima and the brand's thresholds. */
export async function quoteApprovalDecision(ctx: AccessContext, doc: DocDetail): Promise<ApprovalDecision> {
  const db = scopedDb(ctx);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { discountApprovalPct: true, discountEscalationPct: true } });
  let bookId = doc.priceBookId;
  if (!bookId) {
    const books = await db.priceBook.findMany({ where: { brandId: doc.brandId, active: true } });
    bookId = defaultBookFor(books, doc.brandId, new Date(doc.issueDate))?.id ?? null;
  }
  const productIds = doc.lines.map((l) => l.productId).filter((x): x is string => !!x);
  const entries = bookId && productIds.length ? await db.priceBookEntry.findMany({ where: { priceBookId: bookId, productId: { in: productIds } }, select: { productId: true, maxDiscountPct: true } }) : [];
  const decision = discountApproval({
    lines: doc.lines.map((l) => {
      const e = entries.find((x) => x.productId === l.productId);
      return { discountPct: l.discountPct, maxDiscountPct: e?.maxDiscountPct === null || e?.maxDiscountPct === undefined ? null : Number(e.maxDiscountPct.toString()), label: l.description };
    }),
    headerDiscountPct: doc.headerDiscountPct,
    overallDiscountPct: doc.subtotal > 0 ? (doc.discountTotal / doc.subtotal) * 100 : 0,
    approvalPct: Number(brand.discountApprovalPct.toString()),
    escalationPct: Number(brand.discountEscalationPct.toString()),
  });
  // Free-text lines have no price-book maximum: above the brand's amount threshold the discount needs approval too.
  const rules = await rulesOf(ctx, doc.brandId);
  if (rules.discountAmountApproval > 0 && doc.lines.some((l) => !l.productId) && doc.discountTotal > rules.discountAmountApproval) {
    decision.reasons.push(`Discount of ${doc.discountTotal.toFixed(2)} on free-text items is above the brand's amount threshold of ${rules.discountAmountApproval.toFixed(2)}`);
    decision.needed = true;
  }
  return decision;
}

/**
 * Submits a draft quote. Discounts within the limits → Approved. Otherwise → Pending Approval through the
 * DISCOUNT approval process: above the brand's threshold A the Brand Manager decides, above threshold B the
 * Head of Sales decides after them. Steps whose approver is the submitter are approved on the spot.
 */
export async function submitQuote(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "quote", id);
  if (doc.status !== "DRAFT") throw new BadRequestError("Only draft quotes can be submitted");
  if (doc.lines.length === 0) throw new BadRequestError("Add at least one line before submitting");
  const decision = await quoteApprovalDecision(ctx, doc);
  if (!decision.needed) {
    await setStatus(ctx, "quote", id, "APPROVED");
    return { status: "APPROVED" as const, decision };
  }
  const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { discountApprovalPct: true, discountEscalationPct: true } });
  // Status first: the quote is locked as soon as the request exists.
  await setStatus(ctx, "quote", id, "PENDING_APPROVAL");
  try {
    const out = await submitForApproval(ctx, {
      processKey: "DISCOUNT",
      entity: "Quote",
      entityId: id,
      brandId: doc.brandId,
      regionId: doc.regionId,
      title: `Quote ${doc.number}: discount ${decision.effectivePct}%`,
      summary: decision.reasons.join("; "),
      facts: { discountPct: decision.effectivePct, approvalPct: Number(brand.discountApprovalPct.toString()), escalationPct: Number(brand.discountEscalationPct.toString()), total: doc.total },
    });
    if (out.status === "APPROVED") {
      await audit({ ctx, action: "UPDATE", entity: "Quote", entityId: id, brandId: doc.brandId, after: { selfApprovedDiscount: decision.effectivePct, reasons: decision.reasons } });
      return { status: "APPROVED" as const, decision };
    }
    return { status: "PENDING_APPROVAL" as const, decision, approvalRequestId: out.requestId!, approverId: out.pendingApproverIds[0] ?? null };
  } catch (err) {
    // No request was created (e.g. no approver configured): the quote stays a draft.
    await setStatus(ctx, "quote", id, "DRAFT").catch(() => undefined);
    throw err;
  }
}

/** The assigned approver – or Management / Administrator with approve permission – decides. */
export async function decideApproval(ctx: AccessContext, requestId: string, approve: boolean, note?: string | null) {
  const out = await decide(ctx, requestId, approve, note);
  return { entity: out.entity, entityId: out.entityId, approved: approve, status: out.status };
}

/** Back to draft for changes; cancels a pending approval. */
export async function reviseQuote(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "quote", id);
  if (!["PENDING_APPROVAL", "APPROVED", "SENT", "EXPIRED"].includes(doc.status)) throw new BadRequestError("This quote cannot be revised");
  await cancelPendingApprovals("Quote", id);
  await setStatus(ctx, "quote", id, "DRAFT");
}

/** Sending and accepting are blocked until the quote is approved. */
export async function markQuoteSent(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "quote", id);
  if (doc.status === "PENDING_APPROVAL" || doc.status === "DRAFT") throw new ForbiddenError("The quote must be approved before it can be sent");
  if (doc.status !== "APPROVED") throw new BadRequestError("Only approved quotes can be sent");
  await setStatus(ctx, "quote", id, "SENT");
}

export async function acceptQuote(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "quote", id);
  if (doc.status === "PENDING_APPROVAL" || doc.status === "DRAFT") throw new ForbiddenError("The quote must be approved before it can be accepted");
  if (!["APPROVED", "SENT"].includes(doc.status)) throw new BadRequestError("Only approved or sent quotes can be accepted");
  if (doc.date && new Date(`${doc.date}T23:59:59Z`) < new Date()) throw new BadRequestError("This quote has expired – revise it first");
  if (doc.dealId) {
    const other = await scopedDb(ctx).quote.findFirst({ where: { dealId: doc.dealId, status: "ACCEPTED", id: { not: id } }, select: { number: true } });
    if (other) throw new BadRequestError(`Quote ${other.number} is already accepted for this deal`);
  }
  await setStatus(ctx, "quote", id, "ACCEPTED");
}

export async function rejectQuote(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "quote", id);
  if (!["APPROVED", "SENT"].includes(doc.status)) throw new BadRequestError("Only approved or sent quotes can be marked rejected");
  await setStatus(ctx, "quote", id, "REJECTED");
}

/** Marks approved / sent quotes past their validity date as Expired (called when quotes are listed or opened). */
export async function expireQuotes(ctx: AccessContext) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  await scopedDb(ctx).quote.updateMany({ where: { status: { in: ["APPROVED", "SENT"] }, validUntil: { lt: today } }, data: { status: "EXPIRED" } });
}

// ───────────────────────────── conversion ─────────────────────────────

/** A stored line as input for a new document (conversion). */
const lineFrom = (l: DocDetail["lines"][number]): LineData => ({ productId: l.productId, description: l.description, details: l.details, itemCode: l.itemCode, uom: l.uom, isStockItem: l.isStockItem, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, vin: l.vin, discountType: l.discountType, discountValue: l.discountValue, taxes: l.taxes.map(({ name, rate }) => ({ name, rate })), vins: l.vins });

async function copyTo(ctx: AccessContext, source: DocDetail, target: DocType, extra: Record<string, unknown>, opts?: { lines?: DocDetail["lines"]; qty?: Map<string, number> }) {
  const cfg = DOCS[target];
  assertCan(ctx, cfg.module, "create", source);
  const created = await delegate(ctx, cfg).create({
    data: {
      dealId: source.dealId,
      accountId: source.accountId,
      contactId: source.contactId,
      brandId: source.brandId,
      regionId: source.regionId,
      ownerId: source.ownerId,
      currency: source.currency,
      terms: source.terms,
      notes: source.notes,
      priceBookId: source.priceBookId,
      sourceDocumentId: source.id,
      billTo: (source.billTo as object) ?? undefined,
      shipTo: (source.shipTo as object) ?? undefined,
      ...extra,
    },
    select: { id: true },
  });
  const lines = (opts?.lines ?? source.lines).map((l) => ({ ...lineFrom(l), qty: opts?.qty?.get(l.id) ?? l.qty, sourceLineId: l.id }));
  await applyLines(ctx, target, created.id, source.brandId, source.priceBookId, lines as LineData[], { headerDiscountType: source.headerDiscountType, headerDiscountValue: source.headerDiscountValue, documentTaxes: source.documentTaxes, adjustment: source.adjustment }, {}, { history: false });
  return created as { id: string };
}

/** Accepted quote → draft Sales Order (lines copied). One active order per quote. */
export async function convertQuoteToOrder(ctx: AccessContext, quoteId: string) {
  const quote = await load(ctx, "quote", quoteId);
  if (quote.status !== "ACCEPTED") throw new BadRequestError("Only an accepted quote can be converted to a sales order");
  const existing = await scopedDb(ctx).salesOrder.findFirst({ where: { sourceDocumentId: quoteId, status: { not: "CANCELLED" } }, select: { number: true } });
  if (existing) throw new BadRequestError(`Sales order ${existing.number} already exists for this quote`);
  return copyTo(ctx, quote, "salesOrder", { expectedDelivery: addDays(30) });
}

/** Accepted quote → draft Invoice directly, without a sales order (prompt 23). */
export async function convertQuoteToInvoice(ctx: AccessContext, quoteId: string) {
  const quote = await load(ctx, "quote", quoteId);
  if (quote.status !== "ACCEPTED") throw new BadRequestError("Only an accepted quote can be invoiced");
  const rules = await rulesOf(ctx, quote.brandId);
  if (rules.requireOrderBeforeInvoice) throw new ForbiddenError("This brand invoices from sales orders only – create the sales order first");
  const existing = await scopedDb(ctx).invoice.findFirst({ where: { sourceDocumentId: quoteId, status: { not: "VOID" } }, select: { number: true } });
  if (existing) throw new BadRequestError(`Invoice ${existing.number} already exists for this quote`);
  return copyTo(ctx, quote, "invoice", { dueDate: addDays(7) });
}

/** Confirmed (or later) Sales Order → draft Invoice. */
export async function convertOrderToInvoice(ctx: AccessContext, orderId: string, quantities?: Record<string, number>) {
  const order = await load(ctx, "salesOrder", orderId);
  if (!["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(order.status)) throw new BadRequestError("Confirm the sales order before invoicing it");
  // partial invoicing (prompt 24): what remains of each line; a quantity per line id invoices only part of it
  const remaining = order.lines.map((l) => ({ l, left: Math.round((l.qty - l.invoicedQty) * 100) / 100 })).filter((x) => x.left > 0);
  if (!remaining.length) throw new BadRequestError("Every line of this order is invoiced already");
  const qty = new Map<string, number>();
  for (const { l, left } of remaining) {
    const want = quantities?.[l.id] ?? left;
    if (want < 0 || want > left + 1e-9) throw new BadRequestError(`Line “${l.description}”: at most ${left} can still be invoiced`);
    if (want > 0) qty.set(l.id, want);
  }
  if (!qty.size) throw new BadRequestError("Choose at least one quantity to invoice");
  const inv = await copyTo(ctx, order, "invoice", { dueDate: addDays(7) }, { lines: remaining.filter((x) => qty.has(x.l.id)).map((x) => x.l), qty });
  for (const [lineId, q] of qty) await scopedDb(ctx).documentLine.update({ where: { id: lineId }, data: { invoicedQty: { increment: q } } });
  return inv;
}

// ───────────────────────────── sales orders ─────────────────────────────

async function emitConfirmed(ctx: AccessContext, type: "salesOrder" | "invoice", doc: DocDetail, name: "document.confirmed" | "document.voided" | "document.credited" = "document.confirmed", extra: { reason?: string; creditNote?: { number: string; amount: number } } = {}) {
  const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { code: true, erpCompanyCode: true } });
  await emitEvent(name, {
    ...extra,
    documentType: type,
    documentId: doc.id,
    number: doc.number,
    brandId: doc.brandId,
    brandCode: brand.code,
    erpCompanyCode: brand.erpCompanyCode,
    dealId: doc.dealId,
    currency: doc.currency,
    total: doc.total,
  });
}

export async function confirmOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "DRAFT") throw new BadRequestError("Only draft orders can be confirmed");
  if (doc.lines.length === 0) throw new BadRequestError("Add at least one line before confirming");
  if (doc.lines.some((l) => l.needsApproval) && !(await discountApproved(ctx, "SalesOrder", id, doc.updatedAt))) {
    throw new ForbiddenError("Some lines have a discount above the price book maximum – request approval before confirming");
  }
  await setStatus(ctx, "salesOrder", id, "CONFIRMED");
  await emitConfirmed(ctx, "salesOrder", doc);
}

/** Allocation needs a vehicle reserved for the deal (stock reference, prompt 05); its VIN is written to the lines. */
export async function allocateOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "CONFIRMED") throw new BadRequestError("Only confirmed orders can be allocated");
  const db = scopedDb(ctx);
  if (!doc.dealId) {
    // A standalone order (prompt 23): no reserved stock to take – the VIN typed on the vehicle line is the allocation.
    // No stock movement happens; the line is reported as a non-stock line unless a unit with that VIN exists.
    if (!doc.lines.some((l) => l.vin)) throw new BadRequestError("Enter the VIN on the vehicle line, or link a deal with a reserved vehicle");
    await assertVinsComplete(ctx, id);
    await setStatus(ctx, "salesOrder", id, "ALLOCATED");
    return;
  }
  // Only units of the order's own brand reserved for its deal (the DB trigger refuses any other brand as well).
  const reserved = await posting.allocateUnits(doc.dealId, id, doc.brandId, { userId: ctx.userId || null });
  if (reserved.length === 0) throw new BadRequestError("Reserve a vehicle (VIN) on the deal before allocating the order");
  const lines = doc.lines.filter((l) => !l.vin);
  for (const [i, stock] of reserved.entries()) {
    const line = lines.find((l) => l.productId === stock.productId) ?? lines[i];
    if (line) {
      await db.documentLine.update({ where: { id: line.id }, data: { vin: stock.vin } });
      lines.splice(lines.indexOf(line), 1);
    }
  }
  for (const u of reserved) await dispatchEvent("vehicle.status_changed", u.id, doc.brandId);
  await assertVinsComplete(ctx, id);
  await setStatus(ctx, "salesOrder", id, "ALLOCATED");
}

/** Delivery updates the deal (VIN, delivery date) and advances its Blueprint stage to Delivery. */
export async function deliverOrder(ctx: AccessContext, id: string, deliveryDate?: string | null) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "ALLOCATED") throw new BadRequestError("Only allocated orders can be delivered");
  const vin = doc.lines.find((l) => l.vin)?.vin;
  if (!vin) throw new BadRequestError("The order has no VIN allocated");
  const date = deliveryDate ? new Date(deliveryDate) : new Date();
  if (Number.isNaN(date.getTime())) throw new BadRequestError("Invalid delivery date");
  // The deal moves to Delivery only when one is linked; a standalone order skips it silently.
  if (doc.dealId) {
    const deal = await getDeal(ctx, doc.dealId);
    const values = { vinChassisNo: deal.vinChassisNo ?? vin, deliveryDate: date.toISOString().slice(0, 10) };
    const advanced = await advanceDealToStage(ctx, doc.dealId, "DELIVERY", values as never);
    if (!advanced) {
      // Already at / past Delivery (or the pipeline has no such stage): still record VIN and date on the deal.
      await scopedDb(ctx).deal.update({ where: { id: doc.dealId }, data: { vinChassisNo: values.vinChassisNo, deliveryDate: date }, select: { id: true } });
    }
  }
  await setStatus(ctx, "salesOrder", id, "DELIVERED");
  // Gate pass: the units leave stock (cost of sale is posted once, here or when the invoice was issued).
  const out = await posting.deliverUnits(id, doc.brandId, doc.number, date, { userId: ctx.userId || null });
  for (const u of out.units) await dispatchEvent("vehicle.delivered", u.id, doc.brandId);
  for (const j of out.journalIds) await dispatchEvent("journal.posted", j, doc.brandId);
}

export async function cancelOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (!["DRAFT", "CONFIRMED", "ALLOCATED"].includes(doc.status)) throw new BadRequestError("This order can no longer be cancelled");
  await setStatus(ctx, "salesOrder", id, "CANCELLED");
  if (doc.status === "ALLOCATED") {
    const settings = await posting.brandSettings(doc.brandId);
    await posting.deallocateUnits(id, doc.brandId, new Date(Date.now() + settings.reservationDays * 86_400_000), { userId: ctx.userId || null });
  }
}

// ───────────────────────────── invoices & payments ─────────────────────────────

/**
 * Who may issue, void and credit invoices (prompt 26 §7): Brand Managers / managers with invoice approval, brand
 * accountants (inventory finance approval) and administrators – on invoices they can see.
 */
export const canIssueInvoices = (ctx: AccessContext) => !!ctx.isAdmin || hasPermission(ctx, "invoices", "approve") || hasPermission(ctx, "inventoryFinance", "approve");
function assertIssuer(ctx: AccessContext) {
  if (!canIssueInvoices(ctx)) throw new ForbiddenError("Only the Brand Manager, the brand accountant or an administrator can issue, void or credit invoices");
}
/** A sales executive may send the invoice for approval; issuing itself needs canIssueInvoices. */
function assertIssuerOrRequest(ctx: AccessContext, doc: DocDetail) {
  if (canIssueInvoices(ctx)) return;
  assertCan(ctx, "invoices", "edit", doc);
}

/** Does the invoice need a discount approval before it is issued? (a line above its price-book maximum, or above the brand threshold) */
async function invoiceNeedsApproval(ctx: AccessContext, doc: DocDetail) {
  const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { discountApprovalPct: true } });
  const gross = doc.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const pct = gross > 0 ? (doc.discountTotal / gross) * 100 : 0;
  return doc.lines.some((l) => l.needsApproval) || pct > Number(brand.discountApprovalPct ?? 100) + 1e-9;
}

/**
 * Issue (prompt 26 §6): Created → (Pending Approval → Approved) → Issued. A discount above the brand threshold goes to
 * the Brand Manager first – unless a manager issues it. Every vehicle unit needs its VIN.
 */
export async function issueInvoice(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "invoice", id, "approve");
  assertIssuerOrRequest(ctx, doc);
  if (!["DRAFT", "APPROVED"].includes(doc.status)) throw new BadRequestError("Only created or approved invoices can be issued");
  if (doc.lines.length === 0) throw new BadRequestError("Add at least one line before issuing");
  // vehicles allocated on the source sales order carry their VINs there (the sale issue takes those units)
  const allocated = doc.sourceDocumentId ? await scopedDb(ctx).vehicleUnit.count({ where: { salesOrderId: doc.sourceDocumentId, status: { in: ["ALLOCATED", "DELIVERED", "INVOICED"] } } }) : 0;
  const missing = doc.lines.filter((l) => l.isStockItem && (l.vins?.length ?? (l.vin ? 1 : 0)) < Math.ceil(l.qty));
  const noVin = missing.reduce((s, l) => s + Math.ceil(l.qty) - (l.vins?.length ?? (l.vin ? 1 : 0)), 0) > allocated ? missing : [];
  if (noVin.length) throw new BadRequestError(`Every vehicle needs its VIN before the invoice is issued: ${noVin.map((l) => l.description).join(", ")}`);
  if (doc.status === "DRAFT" && (await invoiceNeedsApproval(ctx, doc)) && !(ctx.isAdmin || managedBrands(ctx).includes(doc.brandId))) {
    await setStatus(ctx, "invoice", id, "PENDING_APPROVAL");
    const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { brandManagerId: true } });
    if (brand.brandManagerId && brand.brandManagerId !== ctx.userId) await notify(ctx, [brand.brandManagerId], { kind: "APPROVAL", title: `Invoice ${doc.number} needs your approval`, body: `Discount ${doc.currency} ${doc.discountTotal.toLocaleString("en-NG")}`, href: `/invoices/${id}` });
    return { status: "PENDING_APPROVAL" as const };
  }
  assertIssuer(ctx);
  const rules = await rulesOf(ctx, doc.brandId);
  if (rules.requireStockLinkForVehicleInvoice) {
    const unlinked = await nonStockLines(ctx, doc);
    if (unlinked.length) throw new ForbiddenError(`This brand needs every vehicle line linked to a stock unit before an invoice is issued: ${unlinked.map((l) => l.vin ?? l.description).join(", ")}`);
  }
  await setStatus(ctx, "invoice", id, "ISSUED", { issueDate: new Date(), issuedAt: new Date(), issuedById: ctx.userId || null });
  if (doc.sourceDocumentId) {
    // Sale issue: the order's allocated units leave stock at their own landed cost (Dr COGS / Cr Inventory).
    const out = await posting.issueForInvoice(id, doc.sourceDocumentId, doc.brandId, doc.number, { userId: ctx.userId || null });
    for (const u of out.units) await dispatchEvent("vehicle.status_changed", u.id, doc.brandId);
    for (const j of out.journalIds) await dispatchEvent("journal.posted", j, doc.brandId);
  }
  await emitConfirmed(ctx, "invoice", doc);
  return { status: "ISSUED" as const };
}

/** Pending Approval → Approved (or back to Created): the Brand Manager of the brand, or an administrator. */
export async function decideInvoice(ctx: AccessContext, id: string, approve: boolean, note?: string) {
  const doc = await load(ctx, "invoice", id, "approve");
  if (doc.status !== "PENDING_APPROVAL") throw new BadRequestError("The invoice is not waiting for approval");
  if (!ctx.isAdmin && !managedBrands(ctx).includes(doc.brandId) && !hasPermission(ctx, "invoices", "approve")) throw new ForbiddenError("Only the Brand Manager or an administrator approves invoices");
  await setStatus(ctx, "invoice", id, approve ? "APPROVED" : "DRAFT");
  await audit({ ctx, action: "UPDATE", entity: "Invoice", entityId: id, brandId: doc.brandId, before: { status: doc.status }, after: { status: approve ? "APPROVED" : "DRAFT", note: note ?? null } });
  if (doc.ownerId !== ctx.userId) await notify(ctx, [doc.ownerId], { kind: "APPROVAL", title: `Invoice ${doc.number} ${approve ? "approved" : "sent back"}`, body: note || null, href: `/invoices/${id}` });
  return { status: approve ? "APPROVED" : "DRAFT" };
}

/** Void with a reason (prompt 26): never deleted; no payments or credit notes; the ERP is told to reverse it. */
export async function voidInvoice(ctx: AccessContext, id: string, reason?: string) {
  const doc = await load(ctx, "invoice", id, "approve");
  assertIssuer(ctx);
  const why = (reason ?? "").trim();
  if (why.length < 3) throw new BadRequestError("Give the reason for voiding the invoice");
  if (doc.status === "VOID") throw new BadRequestError("The invoice is void already");
  if ((doc.amountPaid ?? 0) > 0 || (doc.invoice?.creditedAmount ?? 0) > 0 || doc.status === "PAID" || doc.status === "PART_PAID") throw new BadRequestError("An invoice with payments or credit notes cannot be voided");
  await setStatus(ctx, "invoice", id, "VOID", { voidReason: why.slice(0, 500) });
  if ((ISSUED_INVOICE as readonly string[]).includes(doc.status)) await emitConfirmed(ctx, "invoice", doc, "document.voided", { reason: why });
  // partial invoicing: the order's lines can be invoiced again
  const db = scopedDb(ctx);
  for (const l of doc.lines) {
    const src = (l as { sourceLineId?: string | null }).sourceLineId;
    if (src) await db.documentLine.updateMany({ where: { id: src, salesOrderId: { not: null } }, data: { invoicedQty: { decrement: l.qty } } });
  }
}

/** Records a receipt (deposit / balance) and moves the invoice to Part-paid or Paid. */
export async function addPayment(ctx: AccessContext, invoiceId: string, input: unknown) {
  const doc = await load(ctx, "invoice", invoiceId, canIssueInvoices(ctx) ? "approve" : "edit");
  if (!(PAYABLE_INVOICE as readonly string[]).includes(doc.status)) throw new BadRequestError("Payments can be recorded on issued invoices only");
  const data = paymentSchema.parse(input);
  const credited = doc.invoice?.creditedAmount ?? 0;
  const balance = doc.total - (doc.amountPaid ?? 0) - credited;
  if (data.amount > balance + 0.005) throw new BadRequestError(`The payment exceeds the outstanding balance of ${balance.toFixed(2)}`);
  const db = scopedDb(ctx);
  const payment = await db.payment.create({ data: { invoiceId, ...data, receivedById: ctx.userId || null } });
  await audit({ ctx, action: "CREATE", entity: "Payment", entityId: payment.id, brandId: doc.brandId, after: payment });
  const paid = (doc.amountPaid ?? 0) + data.amount;
  const status = settledStatus(doc, paid, credited);
  await setStatus(ctx, "invoice", invoiceId, status, { amountPaid: paid });
  return { id: payment.id, status };
}

/** Status after a payment or credit: Paid when settled, else Partially Paid – Overdue while past due. */
function settledStatus(doc: DocDetail, paid: number, credited: number) {
  const s = paymentStatus(doc.total - credited, paid);
  if (s !== "PAID" && doc.date && doc.date < new Date().toISOString().slice(0, 10)) return "OVERDUE";
  return s === "ISSUED" ? (doc.status === "SENT" ? "SENT" : "ISSUED") : s;
}

/**
 * Credit note (prompt 26): the only correction of an issued invoice – an amount and a reason. Lowers the balance;
 * the ERP gets a document.credited event.
 */
export async function createCreditNote(ctx: AccessContext, invoiceId: string, input: { amount: unknown; reason: unknown }) {
  const doc = await load(ctx, "invoice", invoiceId, "approve");
  assertIssuer(ctx);
  if (!([...PAYABLE_INVOICE, "PAID"] as readonly string[]).includes(doc.status)) throw new BadRequestError("Credit notes are for issued invoices");
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const reason = String(input.reason ?? "").trim();
  if (!(amount > 0)) throw new BadRequestError("Enter the amount of the credit note");
  if (reason.length < 3) throw new BadRequestError("Give the reason for the credit note");
  const credited = doc.invoice?.creditedAmount ?? 0;
  if (amount > doc.total - credited + 0.005) throw new BadRequestError(`At most ${(doc.total - credited).toFixed(2)} can still be credited`);
  const db = scopedDb(ctx);
  const note = await db.creditNote.create({ data: { invoiceId, brandId: doc.brandId, amount, reason: reason.slice(0, 500), createdById: ctx.userId || null }, select: { id: true, number: true } });
  const total = credited + amount;
  const status = doc.status === "PAID" ? "PAID" : settledStatus(doc, doc.amountPaid ?? 0, total);
  await setStatus(ctx, "invoice", invoiceId, status, { creditedAmount: total });
  await audit({ ctx, action: "CREATE", entity: "CreditNote", entityId: note.id, brandId: doc.brandId, after: { invoice: doc.number, number: note.number, amount, reason } });
  await emitConfirmed(ctx, "invoice", doc, "document.credited", { creditNote: { number: note.number, amount } });
  return note;
}

/** Nightly (cron tick): issued invoices past their due date with a balance become Overdue. */
export async function markOverdueInvoices(now = new Date()) {
  const { markOverdue } = await import("@/server/db/document-rules-store");
  return markOverdue(new Date(now.toISOString().slice(0, 10)));
}

// ───────────────────────────── standalone documents and links (prompt 23) ─────────────────────────────

/** The dependency rules of a brand (Setup → Modules and Fields → Dependencies). */
export async function rulesOf(ctx: AccessContext, brandId: string): Promise<DocumentRules> {
  const b = await scopedDb(ctx).brand.findUnique({ where: { id: brandId }, select: { documentRules: true } });
  return parseRules(b?.documentRules);
}

/** A bill-to snapshot from a linked account / contact (the user's view of them – masked fields stay out). */
async function snapshotFrom(ctx: AccessContext, accountId: string | null, contactId: string | null, fallbackName?: string | null): Promise<Partial<Party> | null> {
  const db = scopedDb(ctx);
  const [account, contact] = await Promise.all([
    accountId ? db.account.findUnique({ where: { id: accountId }, select: { name: true, phone: true, email: true, address: true, city: true, state: true, rcNumber: true } }) : null,
    contactId ? db.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, mobile: true, email: true } }) : null,
  ]);
  const person = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : null;
  const name = account?.name ?? person ?? fallbackName ?? null;
  if (!name) return null;
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Partial<Party>;
  return strip({ name, company: account && person ? account.name : null, phone: contact?.mobile ?? account?.phone, email: contact?.email ?? account?.email, address: account?.address, city: account?.city, state: account?.state });
}

/** Fills empty snapshot fields from another snapshot – never overwrites what was typed. */
const fillEmpty = (typed: Partial<Party>, from: Partial<Party> | null): Partial<Party> => {
  const out: Partial<Party> = { ...typed };
  for (const [k, v] of Object.entries(from ?? {})) if (v && !out[k as keyof Party]) (out as Record<string, unknown>)[k] = v;
  return out;
};

/** The user's region in a brand: their own membership region, if they have exactly one there. */
function regionFor(ctx: AccessContext, brandId: string): string | null {
  const regions = [...new Set(ctx.memberships.filter((m) => m.brandId === brandId && m.regionId).map((m) => m.regionId!))];
  return regions.length === 1 ? regions[0]! : null;
}

/** Vehicle lines (stock items or lines with a VIN) that are not linked to a stock unit of the document's brand. */
export async function nonStockLines(ctx: AccessContext, doc: Pick<DocDetail, "brandId" | "lines">) {
  const vehicle = doc.lines.filter((l) => l.isStockItem || l.vin);
  if (!vehicle.length) return [];
  const vins = vehicle.map((l) => l.vin).filter((v): v is string => !!v);
  const units = vins.length ? await scopedDb(ctx).vehicleUnit.findMany({ where: { brandId: doc.brandId, vin: { in: vins } }, select: { vin: true } }) : [];
  return vehicle.filter((l) => !l.vin || !units.some((u) => u.vin === l.vin));
}

/**
 * Creates a quote, sales order or invoice directly (prompt 23): brand, region, the customer's name and at least one
 * line are enough. Deal, account, contact, source document and price book are optional links – each must be of the
 * same brand and visible to the user. Brand rules (Dependencies) can make links mandatory.
 */
export async function createDocument(ctx: AccessContext, type: DocType, input: CreateDocumentInput) {
  const cfg = DOCS[type];
  const data = createSchema.parse(input);
  const db = scopedDb(ctx);

  // links first: a deal decides brand and region
  const deal = data.dealId ? await getDeal(ctx, data.dealId) : null;
  const brandId = deal?.brandId ?? data.brandId ?? (ctx.brandIds.length === 1 ? ctx.brandIds[0]! : null);
  if (!brandId) throw new BadRequestError("Choose the brand");
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (deal && data.brandId && data.brandId !== deal.brandId) throw new ForbiddenError("The deal belongs to another brand");
  if (deal && data.regionId && data.regionId !== deal.regionId) throw new BadRequestError("The deal is in another region – a linked document is always in its deal's region");
  const regionId = deal?.regionId ?? data.regionId ?? regionFor(ctx, brandId);
  if (!regionId) throw new BadRequestError("Choose the region");
  assertCan(ctx, cfg.module, "create", { brandId, regionId });
  const brand = await db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { status: true, documentTerms: true, documentRules: true } });
  if (brand.status === "INACTIVE") throw new BadRequestError("The brand is inactive");
  const rules = parseRules(brand.documentRules);

  const accountId = data.accountId ?? deal?.accountId ?? null;
  const contactId = data.contactId ?? deal?.contactId ?? null;
  if (data.accountId && !(await db.account.findUnique({ where: { id: data.accountId }, select: { id: true } }))) throw new NotFoundError();
  if (data.contactId && !(await db.contact.findUnique({ where: { id: data.contactId }, select: { id: true } }))) throw new NotFoundError();
  let source: DocDetail | null = null;
  if (data.sourceDocumentId) {
    if (type === "quote") throw new BadRequestError("A quote has no source document");
    source = await getDocument(ctx, "quote", data.sourceDocumentId).catch(() => null);
    if (!source && type === "invoice") source = await getDocument(ctx, "salesOrder", data.sourceDocumentId).catch(() => null);
    if (!source) throw new NotFoundError();
    if (source.brandId !== brandId) throw new ForbiddenError("The source document belongs to another brand");
  }

  // the brand's dependency rules
  if (rules.requireAccount && !accountId) throw new ForbiddenError("This brand requires an account on its documents");
  if (rules.requireContact && !contactId) throw new ForbiddenError("This brand requires a contact on its documents");
  if (rules.requireDeal && !deal) throw new ForbiddenError("This brand requires a deal on its documents");
  if (rules.requireProduct && data.lines.some((l) => !l.productId)) throw new ForbiddenError("This brand requires a product on every line – free-text items are not allowed");
  if (type === "salesOrder" && rules.requireQuoteBeforeOrder && source?.type !== "quote") throw new ForbiddenError("This brand creates sales orders from quotes only");
  if (type === "invoice" && rules.requireOrderBeforeInvoice && source?.type !== "salesOrder") throw new ForbiddenError("This brand creates invoices from sales orders only");

  // lines: product prices from the brand's price book unless one was typed; free-text lines need a price
  if (data.priceBookId) {
    const book = await db.priceBook.findUnique({ where: { id: data.priceBookId }, select: { brandId: true } });
    assertSameBrand(brandId, book?.brandId, "The price book");
  }
  const issueDate = data.issueDate ?? new Date();
  const lines: LineData[] = [];
  for (const l of data.lines) {
    let unitPrice = l.unitPrice;
    let taxRate = l.taxRate;
    if (l.productId) {
      const price = await getPrice(ctx, l.productId, issueDate, data.priceBookId); // 404 for a product the user cannot see
      unitPrice ??= price.price ?? undefined;
      taxRate ??= price.taxRatePct;
    }
    if (unitPrice === undefined) throw new BadRequestError(`Enter a unit price for “${l.description}”`);
    lines.push({ ...l, unitPrice, taxRate: taxRate ?? 7.5 });
  }
  await assertLineProducts(ctx, brandId, lines);

  const linked = await snapshotFrom(ctx, accountId, contactId, deal?.customerName);
  const billTo = fillEmpty(data.billTo, linked);
  if ((data.adjustment ?? 0) !== 0) await assertAdjustment(ctx, brandId);
  const typeDate = data.date ?? data[cfg.dateField] ?? (type === "quote" ? addDays(14) : type === "salesOrder" ? addDays(30) : addDays(7));
  const created = await delegate(ctx, cfg).create({
    data: {
      dealId: deal?.id ?? null,
      accountId,
      contactId,
      sourceDocumentId: source?.id ?? null,
      brandId,
      regionId,
      ownerId: ctx.userId,
      currency: data.currency ?? deal?.currency ?? "NGN",
      issueDate,
      [cfg.dateField]: typeDate,
      terms: data.terms ?? brand.documentTerms,
      notes: data.notes,
      priceBookId: data.priceBookId,
      billTo: billTo as object,
      shipTo: data.shipTo ? (data.shipTo as object) : undefined,
    },
    select: { id: true, number: true },
  });
  await applyLines(ctx, type, created.id, brandId, data.priceBookId, lines, data, {}, { history: false });
  // the scoped client audits the CREATE of a brand-owned record (with dealId / accountId null for a standalone one)
  return created as { id: string; number: string };
}

type LinkKey = "dealId" | "accountId" | "contactId" | "sourceDocumentId";

/**
 * Link later: adds (or removes, with null) a deal, account, contact or source document. Same brand, visible to the
 * user, no loops. An issued invoice can be linked, but its lines and amounts never change.
 */
export async function linkDocument(ctx: AccessContext, type: DocType, id: string, input: LinkInput) {
  const cfg = DOCS[type];
  const doc = await load(ctx, type, id);
  const data = linkSchema.parse(input);
  const db = scopedDb(ctx);
  const change: Record<string, string | null> = {};

  if (data.dealId !== undefined) {
    if (data.dealId) {
      const deal = await getDeal(ctx, data.dealId).catch(() => null);
      if (!deal) throw new NotFoundError();
      if (deal.brandId !== doc.brandId) throw new ForbiddenError("The deal belongs to another brand – documents can only be linked within their brand");
      if (deal.regionId !== doc.regionId) throw new BadRequestError("The deal is in another region than the document");
      if (type === "quote" && doc.status === "ACCEPTED") {
        const other = await db.quote.findFirst({ where: { dealId: deal.id, status: "ACCEPTED", id: { not: id } }, select: { number: true } });
        if (other) throw new BadRequestError(`Quote ${other.number} is already accepted for this deal`);
      }
    }
    change.dealId = data.dealId ?? null;
  }
  if (data.accountId !== undefined) {
    if (data.accountId && !(await db.account.findUnique({ where: { id: data.accountId }, select: { id: true } }))) throw new NotFoundError();
    change.accountId = data.accountId ?? null;
  }
  if (data.contactId !== undefined) {
    if (data.contactId && !(await db.contact.findUnique({ where: { id: data.contactId }, select: { id: true } }))) throw new NotFoundError();
    change.contactId = data.contactId ?? null;
  }
  if (data.sourceDocumentId !== undefined) {
    if (data.sourceDocumentId) {
      if (type === "quote") throw new BadRequestError("A quote has no source document");
      if (data.sourceDocumentId === id) throw new BadRequestError("A document cannot be its own source");
      const src = (await getDocument(ctx, "quote", data.sourceDocumentId).catch(() => null)) ?? (type === "invoice" ? await getDocument(ctx, "salesOrder", data.sourceDocumentId).catch(() => null) : null);
      if (!src) throw new NotFoundError();
      if (src.brandId !== doc.brandId) throw new ForbiddenError("The source document belongs to another brand");
      // no loops: the source must not come from this document
      if (src.sourceDocumentId === id) throw new BadRequestError("These documents would refer to each other");
    }
    change.sourceDocumentId = data.sourceDocumentId ?? null;
  }
  if (!Object.keys(change).length && !data.refreshBillTo) throw new BadRequestError("Nothing to link");

  const update: Record<string, unknown> = { ...change };
  if (data.refreshBillTo) {
    const snap = await snapshotFrom(ctx, change.accountId !== undefined ? change.accountId : doc.accountId, change.contactId !== undefined ? change.contactId : doc.contactId);
    if (!snap) throw new BadRequestError("Link an account or a contact to take the bill-to from");
    update.billTo = snap as object;
  }
  await delegate(ctx, cfg).update({ where: { id }, data: update, select: { id: true } });
  const before = Object.fromEntries(Object.keys(change).map((k) => [k, doc[k as LinkKey] ?? null]));
  await audit({ ctx, action: "UPDATE", entity: cfg.model, entityId: id, brandId: doc.brandId, before: { ...before, ...(data.refreshBillTo ? { billTo: doc.billTo } : {}) }, after: { ...change, ...(data.refreshBillTo ? { billTo: update.billTo } : {}), link: true } });
  return getDocument(ctx, type, id);
}

/** "Create customer from this document": an account (and a contact for a person) from the snapshot, then linked. */
export async function createCustomerFromDocument(ctx: AccessContext, type: DocType, id: string) {
  const doc = await load(ctx, type, id);
  if (doc.accountId) throw new BadRequestError("The document already has an account");
  const b = doc.billTo;
  if (!b?.name) throw new BadRequestError("The document has no customer name to create an account from");
  const db = scopedDb(ctx);
  const { normalizePhone } = await import("@/lib/phone");
  const phone = b.phone ? normalizePhone(b.phone) : null;
  // duplicates: an account the user can see with the same phone, e-mail or exact name is linked instead
  const existing = await db.account.findFirst({ where: { deletedAt: null, OR: [...(phone ? [{ phone }] : []), ...(b.email ? [{ email: b.email }] : []), { name: { equals: b.company || b.name, mode: "insensitive" as const } }] }, select: { id: true, name: true } });
  const customers = await import("@/server/modules/customers/service");
  let accountId = existing?.id ?? null;
  if (!accountId) {
    const acc = await customers.createAccount(ctx, { name: b.company || b.name, type: b.company ? "CORPORATE" : "INDIVIDUAL", phone: phone ?? undefined, email: b.email ?? undefined, address: b.address ?? undefined, city: b.city ?? undefined, state: b.state ?? undefined } as never);
    accountId = acc.id;
  }
  let contactId: string | null = null;
  if (b.company && b.name !== b.company) {
    const [first, ...rest] = b.name.split(/\s+/);
    const c = await customers.createContact(ctx, { accountId, firstName: rest.length ? first : undefined, lastName: rest.length ? rest.join(" ") : first, mobile: phone ?? undefined, email: b.email ?? undefined } as never);
    contactId = c.id;
  }
  await linkDocument(ctx, type, id, { accountId, ...(contactId ? { contactId } : {}) });
  return { accountId, contactId, duplicate: !!existing, name: existing?.name ?? b.company ?? b.name };
}

/** "Create deal from this quote": a deal at stage Quotation with brand, region, customer, amount and product. */
export async function createDealFromQuote(ctx: AccessContext, quoteId: string) {
  const quote = await load(ctx, "quote", quoteId);
  if (quote.dealId) throw new BadRequestError("The quote already has a deal");
  const { createDeal } = await import("@/server/modules/deals/service");
  const modelId = quote.lines.find((l) => l.productId)?.productId ?? null;
  const deal = await createDeal(ctx, { name: `${quote.billTo?.name ?? "Customer"} – ${quote.number}`.slice(0, 200), customerName: quote.billTo?.name ?? undefined, brandId: quote.brandId, regionId: quote.regionId, accountId: quote.accountId ?? undefined, contactId: quote.contactId ?? undefined, amount: quote.total, currency: quote.currency, modelId: modelId ?? undefined } as never);
  await advanceDealToStage(ctx, deal.id, "QUOTATION").catch(() => false); // Blueprint may require fields: the deal then stays at its first stage
  await linkDocument(ctx, "quote", quoteId, { dealId: deal.id });
  return { dealId: deal.id };
}

/** Dependency rules: how many OPEN documents of a brand would break a rule if it were switched on now. */
export async function ruleViolations(ctx: AccessContext, brandId: string): Promise<Record<string, number>> {
  const db = scopedDb(ctx);
  const open: Record<"quote" | "salesOrder" | "invoice", any> = { quote: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"] } }, salesOrder: { status: { in: ["DRAFT", "CONFIRMED", "ALLOCATED"] } }, invoice: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "SENT", "PART_PAID", "OVERDUE"] } } };
  const count = async (where: Record<string, unknown>) => {
    let n = 0;
    for (const t of ["quote", "salesOrder", "invoice"] as const) n += await (db as any)[t].count({ where: { brandId, deletedAt: null, ...open[t], ...where } });
    return n;
  };
  const freeText = await db.documentLine.findMany({ where: { productId: null, OR: [{ quote: { brandId, ...open.quote } }, { salesOrder: { brandId, ...open.salesOrder } }, { invoice: { brandId, ...open.invoice } }] }, select: { quoteId: true, salesOrderId: true, invoiceId: true } });
  const stockLines = await db.documentLine.findMany({ where: { invoice: { brandId, status: "DRAFT" }, OR: [{ isStockItem: true }, { vin: { not: null } }] }, select: { invoiceId: true, vin: true } });
  const units = await db.vehicleUnit.findMany({ where: { brandId, vin: { in: stockLines.map((l) => l.vin).filter((v): v is string => !!v) } }, select: { vin: true } });
  return {
    requireAccount: await count({ accountId: null }),
    requireContact: await count({ contactId: null }),
    requireDeal: await count({ dealId: null }),
    requireProduct: new Set(freeText.map((l) => l.quoteId ?? l.salesOrderId ?? l.invoiceId)).size,
    requireQuoteBeforeOrder: await (db as any).salesOrder.count({ where: { brandId, deletedAt: null, ...open.salesOrder, sourceDocumentId: null } }),
    requireOrderBeforeInvoice: await (db as any).invoice.count({ where: { brandId, deletedAt: null, ...open.invoice, sourceDocumentId: null } }),
    requireStockLinkForVehicleInvoice: new Set(stockLines.filter((l) => !l.vin || !units.some((u) => u.vin === l.vin)).map((l) => l.invoiceId)).size,
  };
}

// ───────────────────────────── Ordered Items rules (prompt 24) ─────────────────────────────

/** The adjustment (± amount) may be restricted to the brand's managers and administrators. */
async function assertAdjustment(ctx: AccessContext, brandId: string) {
  const rules = await rulesOf(ctx, brandId);
  if (!rules.adjustmentManagersOnly) return;
  const { managedBrands } = await import("@/server/access/brand-tag");
  if (!ctx.isAdmin && !managedBrands(ctx).includes(brandId)) throw new ForbiddenError("Only the brand's managers can enter an adjustment");
}

/** Every vehicle line of an order needs one VIN per unit before allocation (drafts may be saved without). */
async function assertVinsComplete(ctx: AccessContext, orderId: string) {
  const lines = await scopedDb(ctx).documentLine.findMany({ where: { salesOrderId: orderId, isStockItem: true }, select: { description: true, qty: true, vins: true, vin: true } });
  for (const l of lines) {
    const vins = (l.vins as string[] | null)?.length ? (l.vins as string[]) : l.vin ? [l.vin] : [];
    const need = Math.ceil(Number(l.qty.toString()));
    if (vins.length < need) throw new BadRequestError(`“${l.description}” needs ${need} VIN(s) before allocation – ${vins.length} assigned (Assign VINs)`);
  }
}

/** An approved DISCOUNT request for the document, newer than its last change. */
async function discountApproved(ctx: AccessContext, entity: string, id: string, changedAt: string) {
  const r = await scopedDb(ctx).approvalRequest.findFirst({ where: { entity, entityId: id, kind: "DISCOUNT", status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { decidedAt: true, createdAt: true } });
  return !!r && r.createdAt.getTime() >= new Date(changedAt).getTime() - 1000;
}

/** A sales order whose lines need a discount approval: the DISCOUNT process decides (Brand Manager / Head of Sales). */
export async function requestOrderDiscountApproval(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "DRAFT") throw new BadRequestError("Only draft orders can be sent for discount approval");
  const lines = doc.lines.filter((l) => l.needsApproval);
  if (!lines.length) throw new BadRequestError("No line needs a discount approval");
  const effective = Math.max(...lines.map((l) => l.discountPct));
  const out = await submitForApproval(ctx, { processKey: "DISCOUNT", entity: "SalesOrder", entityId: id, brandId: doc.brandId, regionId: doc.regionId, title: `Sales order ${doc.number}: discount ${effective}%`, summary: lines.map((l) => `${l.description}: ${l.discountPct}%`).join("; "), facts: { discountPct: effective, total: doc.total } });
  return { status: out.status };
}

/** A confirmed order back to draft for changes – the brand's managers and administrators only, audited. */
export async function reopenOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "CONFIRMED") throw new BadRequestError("Only a confirmed (not allocated) order can be reopened");
  const { managedBrands } = await import("@/server/access/brand-tag");
  if (!ctx.isAdmin && !managedBrands(ctx).includes(doc.brandId)) throw new ForbiddenError("Only the brand's managers can reopen a confirmed order");
  if (doc.lines.some((l) => l.invoicedQty > 0)) throw new BadRequestError("The order is invoiced – it cannot be reopened");
  await setStatus(ctx, "salesOrder", id, "DRAFT");
  await audit({ ctx, action: "UPDATE", entity: "SalesOrder", entityId: id, brandId: doc.brandId, before: { status: "CONFIRMED" }, after: { status: "DRAFT", reopened: true } });
}

/** "Assign VINs": one VIN per unit of each vehicle line of a confirmed or draft order. */
export async function assignVins(ctx: AccessContext, id: string, input: Record<string, string[]>) {
  const doc = await load(ctx, "salesOrder", id);
  if (!["DRAFT", "CONFIRMED"].includes(doc.status)) throw new BadRequestError("VINs are assigned before allocation");
  const typed = Object.values(input).flat().map((v) => v.trim().toUpperCase()).filter(Boolean);
  const twice = typed.find((v, i) => typed.indexOf(v) !== i);
  if (twice) throw new BadRequestError(`VIN ${twice} appears twice on this document`);
  const rules = await rulesOf(ctx, doc.brandId);
  const lines = doc.lines.map((l) => normaliseLine({ ...lineFrom(l), id: l.id, vins: input[l.id] ?? l.vins } as LineData, rules));
  await assertVins(ctx, "salesOrder", id, doc.brandId, lines);
  for (const l of lines) await scopedDb(ctx).documentLine.update({ where: { id: l.id! }, data: { vins: l.vins, vin: l.vins[0] ?? null, isStockItem: l.isStockItem || l.vins.length > 0 } });
  await audit({ ctx, action: "UPDATE", entity: "SalesOrder", entityId: id, brandId: doc.brandId, after: { vins: Object.fromEntries(lines.map((l) => [l.id, l.vins])) } });
}
