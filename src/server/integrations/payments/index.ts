/**
 * Online payments (prompt 13): Paystack / Flutterwave payment links for invoices and booking deposits.
 *
 * Each brand is its own legal entity with its own merchant account: keys are read per brand
 * (`PAYSTACK_SECRET_KEY_<BRAND>`, falling back to `PAYSTACK_SECRET_KEY`); a brand without a key has the
 * feature switched off. The provider's webhook (`/api/public/webhooks/payments/<provider>`) is verified with
 * the key of the brand the payment reference belongs to and then books the receipt on the invoice – once.
 */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AccessContext } from "@/server/access/types";
import { assertCan } from "@/server/access/can";
import { audit } from "@/server/db";
import * as store from "@/server/db/api-store";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { brandEnv } from "../config";

export interface PaymentProvider {
  key: "paystack" | "flutterwave";
  label: string;
  /** the brand's secret for this provider; undefined = not configured for the brand */
  secret(brandCode: string): string | undefined;
  createLink(input: { reference: string; amount: number; currency: string; email: string; description: string; brandCode: string; callbackUrl?: string }): Promise<string>;
  /** authenticity of a webhook call for the given brand */
  verify(rawBody: string, headers: Headers, brandCode: string): boolean;
  /** reference + outcome of a webhook body; null for events that are not a completed charge */
  parse(body: unknown): { reference: string; paid: boolean; amount: number } | null;
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function call(url: string, secret: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BadRequestError(`The payment provider rejected the request (HTTP ${res.status})`);
  return json;
}

export const paystack: PaymentProvider = {
  key: "paystack",
  label: "Paystack",
  secret: (code) => brandEnv("PAYSTACK_SECRET_KEY", code),
  async createLink({ reference, amount, currency, email, brandCode, callbackUrl }) {
    const base = (brandEnv("PAYSTACK_BASE_URL", brandCode) ?? "https://api.paystack.co").replace(/\/$/, "");
    // Paystack amounts are in kobo
    const json = await call(`${base}/transaction/initialize`, this.secret(brandCode)!, { reference, amount: Math.round(amount * 100), currency, email, ...(callbackUrl ? { callback_url: callbackUrl } : {}) });
    const url = (json.data as { authorization_url?: string } | undefined)?.authorization_url;
    if (!url) throw new BadRequestError("Paystack did not return a payment link");
    return url;
  },
  /** `x-paystack-signature` = HMAC-SHA512 of the raw body with the merchant's secret key */
  verify(rawBody, headers, brandCode) {
    const secret = this.secret(brandCode);
    const given = headers.get("x-paystack-signature");
    return !!secret && !!given && equal(given, createHmac("sha512", secret).update(rawBody).digest("hex"));
  },
  parse(body) {
    const b = body as { event?: string; data?: { reference?: string; amount?: number; status?: string } };
    if (b?.event !== "charge.success" || !b.data?.reference) return null;
    return { reference: b.data.reference, paid: b.data.status === "success", amount: Number(b.data.amount ?? 0) / 100 };
  },
};

export const flutterwave: PaymentProvider = {
  key: "flutterwave",
  label: "Flutterwave",
  secret: (code) => brandEnv("FLUTTERWAVE_SECRET_KEY", code),
  async createLink({ reference, amount, currency, email, description, brandCode, callbackUrl }) {
    const base = (brandEnv("FLUTTERWAVE_BASE_URL", brandCode) ?? "https://api.flutterwave.com/v3").replace(/\/$/, "");
    const json = await call(`${base}/payments`, this.secret(brandCode)!, { tx_ref: reference, amount, currency, redirect_url: callbackUrl ?? "https://example.invalid/", customer: { email }, customizations: { title: description } });
    const url = (json.data as { link?: string } | undefined)?.link;
    if (!url) throw new BadRequestError("Flutterwave did not return a payment link");
    return url;
  },
  /** `verif-hash` = the secret hash configured in the merchant's dashboard (FLUTTERWAVE_WEBHOOK_HASH) */
  verify(_rawBody, headers, brandCode) {
    const hash = brandEnv("FLUTTERWAVE_WEBHOOK_HASH", brandCode);
    const given = headers.get("verif-hash");
    return !!hash && !!given && equal(given, hash);
  },
  parse(body) {
    const b = body as { event?: string; data?: { tx_ref?: string; amount?: number; status?: string } };
    if (b?.event !== "charge.completed" || !b.data?.tx_ref) return null;
    return { reference: b.data.tx_ref, paid: b.data.status === "successful", amount: Number(b.data.amount ?? 0) };
  },
};

export const PAYMENT_PROVIDERS: Record<string, PaymentProvider> = { paystack, flutterwave };

/** Providers configured for a brand (empty = online payments are off for it). */
export function providersFor(brandCode: string): PaymentProvider[] {
  return Object.values(PAYMENT_PROVIDERS).filter((p) => !!p.secret(brandCode));
}

/**
 * Creates a payment link for an invoice the caller can edit. `amount` defaults to the outstanding balance; a
 * smaller amount is a deposit (e.g. the booking deposit).
 */
export async function createPaymentLink(ctx: AccessContext, invoiceId: string, input: { provider?: string; amount?: number | string | null; email?: string | null }) {
  const { getDocument } = await import("@/server/modules/documents/queries");
  const doc = await getDocument(ctx, "invoice", invoiceId); // 404 outside the caller's scope
  assertCan(ctx, "invoices", "edit", doc);
  if (!["ISSUED", "SENT", "PART_PAID", "OVERDUE"].includes(doc.status)) throw new BadRequestError("Payment links can be created for issued invoices only");
  const brand = await store.brandForIntegration(doc.brandId);
  const available = brand ? providersFor(brand.code) : [];
  const provider = input.provider ? available.find((p) => p.key === input.provider) : available[0];
  if (!brand || !provider) throw new BadRequestError("Online payments are not configured for this brand");
  const balance = Math.round((doc.total - (doc.amountPaid ?? 0) - (doc.invoice?.creditedAmount ?? 0)) * 100) / 100;
  const amount = input.amount === undefined || input.amount === null || input.amount === "" ? balance : Number(input.amount);
  if (!(amount > 0) || amount > balance + 0.005) throw new BadRequestError(`The amount must be between 0 and the outstanding balance of ${balance.toFixed(2)}`);
  const email = input.email?.trim() || (await store.invoiceCustomerEmail(invoiceId));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestError("The customer needs an e-mail address for the payment receipt");
  const reference = `${doc.number}-${randomBytes(4).toString("hex")}`.replace(/[^A-Za-z0-9-]/g, "-");
  const url = await provider.createLink({ reference, amount, currency: doc.currency, email, description: `${brand.name} – invoice ${doc.number}`, brandCode: brand.code, callbackUrl: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/invoices/${invoiceId}` : undefined });
  const link = await store.insertPaymentLink({ invoiceId, brandId: doc.brandId, provider: provider.key, reference, amount, url, createdById: ctx.userId || null });
  await audit({ ctx, action: "CREATE", entity: "PaymentLink", entityId: link.id, brandId: doc.brandId, after: { invoice: doc.number, provider: provider.key, reference, amount } });
  return { id: link.id, provider: provider.key, reference, amount, url };
}

/** Links of an invoice the caller can see. */
export async function invoicePaymentLinks(ctx: AccessContext, invoiceId: string) {
  const { getDocument } = await import("@/server/modules/documents/queries");
  await getDocument(ctx, "invoice", invoiceId);
  return (await store.paymentLinksOf(invoiceId)).map((l) => ({ id: l.id, provider: l.provider, reference: l.reference, amount: Number(l.amount.toString()), url: l.url, status: l.status, createdAt: l.createdAt.toISOString() }));
}

/**
 * Provider webhook. Returns the HTTP status to answer with: 401 for a bad signature, 200 otherwise (providers
 * retry on anything else; unknown references and repeated events are acknowledged without effect).
 */
export async function handlePaymentWebhook(providerKey: string, rawBody: string, headers: Headers): Promise<{ status: number; result: string }> {
  const provider = PAYMENT_PROVIDERS[providerKey];
  if (!provider) return { status: 404, result: "unknown provider" };
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, result: "invalid body" };
  }
  const event = provider.parse(body);
  // The signature is checked with the key of the brand the reference belongs to. Without a known reference
  // nothing can be verified – answer like a bad signature so the endpoint reveals nothing.
  const link = event ? await store.findPaymentLink(event.reference) : null;
  if (!event || !link || link.provider !== provider.key) return { status: event ? 401 : 200, result: event ? "unverified" : "ignored" };
  const brand = await store.brandForIntegration(link.brandId);
  if (!brand || !provider.verify(rawBody, headers, brand.code)) return { status: 401, result: "unverified" };
  if (!event.paid) {
    await store.settlePaymentLink(link.reference, "FAILED");
    return { status: 200, result: "failed" };
  }
  if (!(await store.settlePaymentLink(link.reference, "PAID"))) return { status: 200, result: "duplicate" };
  try {
    const { automationContext } = await import("@/server/modules/workflow/engine");
    const { addPayment } = await import("@/server/modules/documents/service");
    // what the provider actually collected, never more than the link was created for
    const amount = Math.min(event.amount > 0 ? event.amount : Number(link.amount.toString()), Number(link.amount.toString()));
    await addPayment(automationContext(link.brandId), link.invoiceId, { amount, method: "ONLINE", reference: link.reference });
    return { status: 200, result: "paid" };
  } catch (err) {
    logger.error({ err, reference: link.reference }, "online payment could not be booked");
    return { status: 200, result: "received – booking failed, see log" };
  }
}
