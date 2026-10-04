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
  "invoice:issue": (ctx, id) => svc.issueInvoice(ctx, id).then(() => "Invoice issued"),
  "invoice:void": (ctx, id) => svc.voidInvoice(ctx, id).then(() => "Invoice voided"),
} satisfies Record<string, (ctx: Awaited<ReturnType<typeof requireContext>>, id: string) => Promise<string>>;

/** Status transitions (submit, send, accept, confirm, allocate, deliver, issue …). */
export async function transitionAction(type: string, id: string, op: string) {
  return safeAction(async () => {
    const fn = (TRANSITIONS as Record<string, (ctx: Awaited<ReturnType<typeof requireContext>>, id: string) => Promise<string>>)[`${type}:${op}`];
    if (!fn || !isDocType(type)) throw new BadRequestError("Unknown action");
    const message = await fn(await requireContext(), id);
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
