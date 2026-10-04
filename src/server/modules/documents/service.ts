import "server-only";
import { assertSameBrand } from "@/server/access/brand-tag";
import { assertCan } from "@/server/access/can";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { cancelPendingApprovals } from "@/server/db/approval-engine";
import { BadRequestError } from "@/server/errors";
import { emitEvent } from "@/server/events";
import { getPrice } from "@/server/modules/catalogue/queries";
import { defaultBookFor } from "@/server/modules/catalogue/pricing";
import { getDeal } from "@/server/modules/deals/queries";
import { decide, submitForApproval } from "@/server/modules/approvals/service";
import { advanceDealToStage } from "@/server/modules/deals/service";
import { DOCS, paymentSchema, saveSchema, type DocConfig, type DocType, type LineData, type SaveInput } from "./config";
import { getDocument, type DocDetail } from "./queries";
import { computeTotals, discountApproval, paymentStatus, type ApprovalDecision } from "./totals";

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

async function writeLines(ctx: AccessContext, cfg: DocConfig, docId: string, lines: LineData[], lineTotals: number[]) {
  const db = scopedDb(ctx);
  await db.documentLine.deleteMany({ where: { [cfg.lineKey]: docId } });
  if (lines.length) {
    await db.documentLine.createMany({
      data: lines.map((l, i) => ({ [cfg.lineKey]: docId, position: i + 1, productId: l.productId, description: l.description, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, lineTotal: lineTotals[i]!, vin: l.vin })) as any,
    });
  }
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
    });
  }
  const totals = computeTotals(lines, 0);
  const quote = await db.quote.create({
    data: {
      dealId,
      accountId: deal.accountId,
      contactId: deal.contactId,
      brandId: deal.brandId,
      regionId: deal.regionId,
      ownerId: deal.ownerId,
      currency: deal.currency,
      validUntil: addDays(14),
      terms: brand.documentTerms,
      priceBookId: book?.id ?? null,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
    },
    select: { id: true },
  });
  await writeLines(ctx, DOCS.quote, quote.id, lines, totals.lineTotals);
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
  const totals = computeTotals(data.lines, data.headerDiscountPct);
  await writeLines(ctx, cfg, id, data.lines, totals.lineTotals);
  await delegate(ctx, cfg).update({
    where: { id },
    data: {
      headerDiscountPct: data.headerDiscountPct,
      [cfg.dateField]: data.date,
      terms: data.terms,
      notes: data.notes,
      priceBookId: data.priceBookId,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
    },
    select: { id: true },
  });
  return { id, ...totals };
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
  return discountApproval({
    lines: doc.lines.map((l) => {
      const e = entries.find((x) => x.productId === l.productId);
      return { discountPct: l.discountPct, maxDiscountPct: e?.maxDiscountPct === null || e?.maxDiscountPct === undefined ? null : Number(e.maxDiscountPct.toString()), label: l.description };
    }),
    headerDiscountPct: doc.headerDiscountPct,
    overallDiscountPct: doc.subtotal > 0 ? (doc.discountTotal / doc.subtotal) * 100 : 0,
    approvalPct: Number(brand.discountApprovalPct.toString()),
    escalationPct: Number(brand.discountEscalationPct.toString()),
  });
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
  const other = await scopedDb(ctx).quote.findFirst({ where: { dealId: doc.dealId, status: "ACCEPTED", id: { not: id } }, select: { number: true } });
  if (other) throw new BadRequestError(`Quote ${other.number} is already accepted for this deal`);
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

async function copyTo(ctx: AccessContext, source: DocDetail, target: DocType, extra: Record<string, unknown>) {
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
      headerDiscountPct: source.headerDiscountPct,
      subtotal: source.subtotal,
      discountTotal: source.discountTotal,
      taxTotal: source.taxTotal,
      total: source.total,
      terms: source.terms,
      notes: source.notes,
      priceBookId: source.priceBookId,
      sourceDocumentId: source.id,
      ...extra,
    },
    select: { id: true },
  });
  await writeLines(ctx, cfg, created.id, source.lines, source.lines.map((l) => l.lineTotal));
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

/** Confirmed (or later) Sales Order → draft Invoice. */
export async function convertOrderToInvoice(ctx: AccessContext, orderId: string) {
  const order = await load(ctx, "salesOrder", orderId);
  if (!["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(order.status)) throw new BadRequestError("Confirm the sales order before invoicing it");
  const existing = await scopedDb(ctx).invoice.findFirst({ where: { sourceDocumentId: orderId, status: { not: "VOID" } }, select: { number: true } });
  if (existing) throw new BadRequestError(`Invoice ${existing.number} already exists for this order`);
  return copyTo(ctx, order, "invoice", { dueDate: addDays(7) });
}

// ───────────────────────────── sales orders ─────────────────────────────

async function emitConfirmed(ctx: AccessContext, type: "salesOrder" | "invoice", doc: DocDetail) {
  const brand = await scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { code: true, erpCompanyCode: true } });
  await emitEvent("document.confirmed", {
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
  await setStatus(ctx, "salesOrder", id, "CONFIRMED");
  await emitConfirmed(ctx, "salesOrder", doc);
}

/** Allocation needs a vehicle reserved for the deal (stock reference, prompt 05); its VIN is written to the lines. */
export async function allocateOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (doc.status !== "CONFIRMED") throw new BadRequestError("Only confirmed orders can be allocated");
  const db = scopedDb(ctx);
  const reserved = await db.vehicleStockRef.findMany({ where: { dealId: doc.dealId, status: "RESERVED" }, orderBy: { vin: "asc" } });
  if (reserved.length === 0) throw new BadRequestError("Reserve a vehicle (VIN) on the deal before allocating the order");
  const lines = doc.lines.filter((l) => !l.vin);
  for (const [i, stock] of reserved.entries()) {
    const line = lines.find((l) => l.productId === stock.productId) ?? lines[i];
    if (line) {
      await db.documentLine.update({ where: { id: line.id }, data: { vin: stock.vin } });
      lines.splice(lines.indexOf(line), 1);
    }
  }
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
  const deal = await getDeal(ctx, doc.dealId);
  const values = { vinChassisNo: deal.vinChassisNo ?? vin, deliveryDate: date.toISOString().slice(0, 10) };
  const advanced = await advanceDealToStage(ctx, doc.dealId, "DELIVERY", values as never);
  if (!advanced) {
    // Already at / past Delivery (or the pipeline has no such stage): still record VIN and date on the deal.
    await scopedDb(ctx).deal.update({ where: { id: doc.dealId }, data: { vinChassisNo: values.vinChassisNo, deliveryDate: date }, select: { id: true } });
  }
  await setStatus(ctx, "salesOrder", id, "DELIVERED");
}

export async function cancelOrder(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "salesOrder", id);
  if (!["DRAFT", "CONFIRMED", "ALLOCATED"].includes(doc.status)) throw new BadRequestError("This order can no longer be cancelled");
  await setStatus(ctx, "salesOrder", id, "CANCELLED");
}

// ───────────────────────────── invoices & payments ─────────────────────────────

export async function issueInvoice(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "invoice", id);
  if (doc.status !== "DRAFT") throw new BadRequestError("Only draft invoices can be issued");
  if (doc.lines.length === 0) throw new BadRequestError("Add at least one line before issuing");
  await setStatus(ctx, "invoice", id, "ISSUED", { issueDate: new Date() });
  await emitConfirmed(ctx, "invoice", doc);
}

export async function voidInvoice(ctx: AccessContext, id: string) {
  const doc = await load(ctx, "invoice", id);
  if (!["DRAFT", "ISSUED"].includes(doc.status) || (doc.amountPaid ?? 0) > 0) throw new BadRequestError("An invoice with payments cannot be voided");
  await setStatus(ctx, "invoice", id, "VOID");
}

/** Records a receipt (deposit / balance) and moves the invoice to Part-paid or Paid. */
export async function addPayment(ctx: AccessContext, invoiceId: string, input: unknown) {
  const doc = await load(ctx, "invoice", invoiceId);
  if (!["ISSUED", "PART_PAID"].includes(doc.status)) throw new BadRequestError("Payments can be recorded on issued invoices only");
  const data = paymentSchema.parse(input);
  const balance = doc.total - (doc.amountPaid ?? 0);
  if (data.amount > balance + 0.005) throw new BadRequestError(`The payment exceeds the outstanding balance of ${balance.toFixed(2)}`);
  const db = scopedDb(ctx);
  const payment = await db.payment.create({ data: { invoiceId, ...data, receivedById: ctx.userId || null } });
  await audit({ ctx, action: "CREATE", entity: "Payment", entityId: payment.id, brandId: doc.brandId, after: payment });
  const paid = (doc.amountPaid ?? 0) + data.amount;
  await setStatus(ctx, "invoice", invoiceId, paymentStatus(doc.total, paid), { amountPaid: paid });
  return { id: payment.id, status: paymentStatus(doc.total, paid) };
}
