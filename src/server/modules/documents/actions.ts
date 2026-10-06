"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import { DOCS, type DocType, type SaveInput } from "./config";
import * as svc from "./service";

const isDocType = (t: string): t is DocType => t in DOCS;

/** New quote from a deal. */
export async function createQuoteAction(dealId: string) {
  return safeAction(async () => {
    const q = await svc.createQuoteFromDeal(await requireContext(), dealId);
    revalidatePath(`/deals/${dealId}`);
    return { id: q.id, redirect: `/quotes/${q.id}` };
  });
}

/** Save lines + header of a draft document. Returns the server-computed totals. */
export async function saveDocumentAction(type: string, id: string, input: SaveInput) {
  return safeAction(async () => {
    if (!isDocType(type)) throw new BadRequestError("Unknown document type");
    const res = await svc.saveDocument(await requireContext(), type, id, input);
    revalidatePath(`${DOCS[type].path}/${id}`);
    return res;
  });
}

const TRANSITIONS = {
  "quote:submit": (ctx, id) => svc.submitQuote(ctx, id).then((r) => (r.status === "APPROVED" ? "Quote approved" : "Sent for approval")),
  "quote:revise": (ctx, id) => svc.reviseQuote(ctx, id).then(() => "Quote is a draft again"),
  "quote:send": (ctx, id) => svc.markQuoteSent(ctx, id).then(() => "Quote marked as sent"),
  "quote:accept": (ctx, id) => svc.acceptQuote(ctx, id).then(() => "Quote accepted"),
  "quote:reject": (ctx, id) => svc.rejectQuote(ctx, id).then(() => "Quote marked as rejected"),
  "salesOrder:confirm": (ctx, id) => svc.confirmOrder(ctx, id).then(() => "Sales order confirmed"),
  "salesOrder:allocate": (ctx, id) => svc.allocateOrder(ctx, id).then(() => "Vehicle allocated"),
  "salesOrder:deliver": (ctx, id) => svc.deliverOrder(ctx, id).then(() => "Order delivered – the deal moved to Delivery"),
  "salesOrder:cancel": (ctx, id) => svc.cancelOrder(ctx, id).then(() => "Sales order cancelled"),
  "invoice:issue": (ctx, id) => svc.issueInvoice(ctx, id).then((r) => (r.status === "PENDING_APPROVAL" ? "The discount needs approval – sent to the Brand Manager" : "Invoice issued")),
  "invoice:approve": (ctx, id, note) => svc.decideInvoice(ctx, id, true, note).then(() => "Invoice approved – it can be issued"),
  "invoice:sendBack": (ctx, id, note) => svc.decideInvoice(ctx, id, false, note).then(() => "Invoice sent back"),
  "invoice:void": (ctx, id, note) => svc.voidInvoice(ctx, id, note).then(() => "Invoice voided"),
} satisfies Record<string, (ctx: Awaited<ReturnType<typeof requireContext>>, id: string, note?: string) => Promise<string>>;

/** Status transitions (submit, send, accept, confirm, allocate, deliver, issue …). */
export async function transitionAction(type: string, id: string, op: string, note?: string) {
  return safeAction(async () => {
    const fn = (TRANSITIONS as Record<string, (ctx: Awaited<ReturnType<typeof requireContext>>, id: string, note?: string) => Promise<string>>)[`${type}:${op}`];
    if (!fn || !isDocType(type)) throw new BadRequestError("Unknown action");
    const message = await fn(await requireContext(), id, note);
    revalidatePath(`${DOCS[type].path}/${id}`);
    return { message };
  });
}

/** Quote → Sales Order, Sales Order → Invoice. */
export async function convertAction(type: string, id: string) {
  return safeAction(async () => {
    const ctx = await requireContext();
    if (type === "quote") {
      const so = await svc.convertQuoteToOrder(ctx, id);
      return { message: "Sales order created", redirect: `/salesOrders/${so.id}` };
    }
    if (type === "salesOrder") {
      const inv = await svc.convertOrderToInvoice(ctx, id);
      return { message: "Invoice created", redirect: `/invoices/${inv.id}` };
    }
    throw new BadRequestError("This document cannot be converted");
  });
}

export async function decideApprovalAction(requestId: string, approve: boolean, note: string) {
  return safeAction(async () => {
    const res = await svc.decideApproval(await requireContext(), requestId, approve, note);
    revalidatePath("/", "layout");
    return { message: !approve ? "Rejected – the quote is a draft again" : res.status === "PENDING" ? "Approved – waiting for the next approver" : "Approved" };
  });
}

export async function addPaymentAction(invoiceId: string, input: { amount: string; method: string; reference: string; receivedAt: string }) {
  return safeAction(async () => {
    const res = await svc.addPayment(await requireContext(), invoiceId, input);
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: res.status === "PAID" ? "Payment recorded – invoice paid" : "Payment recorded" };
  });
}

/** Credit note on an issued invoice (amount + reason). */
export async function creditNoteAction(invoiceId: string, input: { amount: string; reason: string }) {
  return safeAction(async () => {
    const note = await svc.createCreditNote(await requireContext(), invoiceId, input);
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: `Credit note ${note.number} created` };
  });
}

// ───────────────────────────── standalone documents (prompt 23) ─────────────────────────────

/** Creates a quote, sales order or invoice from the standalone form (one JSON payload). */
export async function createDocumentAction(type: string, payload: Record<string, unknown>, templateId?: string | null) {
  return safeAction(async () => {
    if (!isDocType(type)) throw new BadRequestError("Unknown document type");
    const ctx = await requireContext();
    const { createWithTemplate } = await import("@/server/modules/rectpl/service");
    const made = await createWithTemplate(ctx, DOCS[type].module, templateId || null, payload, (input) => svc.createDocument(ctx, type, input as never));
    revalidatePath(DOCS[type].path);
    return { id: made.record.id, message: `${DOCS[type].label} ${made.record.number} created`, redirect: made.next ?? `${DOCS[type].path}/${made.record.id}` };
  });
}

/** Link later (or unlink with null). */
export async function linkDocumentAction(type: string, id: string, input: Record<string, unknown>) {
  return safeAction(async () => {
    if (!isDocType(type)) throw new BadRequestError("Unknown document type");
    await svc.linkDocument(await requireContext(), type, id, input as never);
    revalidatePath(`${DOCS[type].path}/${id}`);
    return { message: "Links saved" };
  });
}

export async function createCustomerFromDocumentAction(type: string, id: string) {
  return safeAction(async () => {
    if (!isDocType(type)) throw new BadRequestError("Unknown document type");
    const res = await svc.createCustomerFromDocument(await requireContext(), type, id);
    revalidatePath(`${DOCS[type].path}/${id}`);
    return { message: res.duplicate ? `Linked to the existing customer ${res.name}` : `Customer ${res.name} created and linked` };
  });
}

export async function createDealFromQuoteAction(id: string) {
  return safeAction(async () => {
    const res = await svc.createDealFromQuote(await requireContext(), id);
    revalidatePath(`/quotes/${id}`);
    return { message: "Deal created and linked", redirect: `/deals/${res.dealId}` };
  });
}

/** Quote → Invoice directly. */
export async function quoteToInvoiceAction(id: string) {
  return safeAction(async () => {
    const inv = await svc.convertQuoteToInvoice(await requireContext(), id);
    return { message: "Invoice created", redirect: `/invoices/${inv.id}` };
  });
}

// lookups of the form
export async function searchCustomersAction(q: string) {
  return safeAction(async () => (await import("./lookups")).searchCustomers(await requireContext(), q));
}
export async function customerByPhoneAction(phone: string) {
  return safeAction(async () => (await import("./lookups")).customerByPhone(await requireContext(), phone));
}
export async function linkTargetsAction(brandId: string, kind: "deal" | "quote" | "salesOrder", q: string) {
  return safeAction(async () => (await import("./lookups")).linkTargets(await requireContext(), brandId, kind, q));
}
export async function brandProductsAction(brandId: string) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const l = await import("./lookups");
    return { products: await l.brandProducts(ctx, brandId), canSaveAsProduct: l.canSaveAsProduct(ctx, brandId), grid: await l.gridSettings(ctx, brandId) };
  });
}
export async function saveLineAsProductAction(brandId: string, input: { name: string; price: number; vehicle: boolean }) {
  return safeAction(async () => (await import("./lookups")).saveLineAsProduct(await requireContext(), brandId, input));
}

/** Setup → Modules and Fields → Dependencies: the rules of one brand. */
export async function saveDocumentRulesAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const { DOCUMENT_RULES, saveRules } = await import("./rules");
    const brandId = String(fd.get("brandId") ?? "");
    const input: Record<string, unknown> = Object.fromEntries(Object.keys(DOCUMENT_RULES).map((k) => [k, fd.get(k) === "on"]));
    input.discountAmountApproval = Number(fd.get("discountAmountApproval") || 0);
    // Ordered Items grid: taxes offered (name + rate rows), tax mode, rounding, who may enter an adjustment
    const names = fd.getAll("taxName").map(String);
    const rates = fd.getAll("taxRate").map(String);
    input.taxes = names.map((name, i) => ({ name: name.trim(), rate: rates[i] ?? "" })).filter((t) => t.name && t.rate !== "");
    input.taxMode = fd.get("taxMode") === "DOCUMENT" ? "DOCUMENT" : "LINE";
    input.roundingMode = fd.get("roundingMode") === "HALF_EVEN" ? "HALF_EVEN" : "HALF_UP";
    input.adjustmentManagersOnly = fd.get("adjustmentManagersOnly") === "on";
    await saveRules(ctx, brandId, input);
    revalidatePath("/setup/document-dependencies");
    return { message: "Dependencies saved – they apply to new documents" };
  });
}

// ── Ordered Items grid (prompt 24) ──
export async function stockUnitsAction(brandId: string, opts: { q?: string; productId?: string }) {
  return safeAction(async () => (await import("./lookups")).stockUnits(await requireContext(), brandId, opts));
}

export async function assignVinsAction(id: string, vins: Record<string, string[]>) {
  return safeAction(async () => {
    await svc.assignVins(await requireContext(), id, vins);
    revalidatePath(`/salesOrders/${id}`);
    return { message: "VINs assigned" };
  });
}

export async function requestOrderApprovalAction(id: string) {
  return safeAction(async () => {
    const res = await svc.requestOrderDiscountApproval(await requireContext(), id);
    revalidatePath(`/salesOrders/${id}`);
    return { message: res.status === "APPROVED" ? "Discount approved" : "Sent for discount approval" };
  });
}

export async function reopenOrderAction(id: string) {
  return safeAction(async () => {
    await svc.reopenOrder(await requireContext(), id);
    revalidatePath(`/salesOrders/${id}`);
    return { message: "The order is a draft again" };
  });
}

/** Sales order → invoice for chosen quantities per line (partial invoicing). */
export async function invoicePartAction(orderId: string, quantities: Record<string, number>) {
  return safeAction(async () => {
    const inv = await svc.convertOrderToInvoice(await requireContext(), orderId, quantities);
    revalidatePath(`/salesOrders/${orderId}`);
    return { message: "Invoice created", redirect: `/invoices/${inv.id}` };
  });
}
