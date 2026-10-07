/**
 * The "Create Quote" page (Zoho-style form): one save for create and edit on top of the standalone document service
 * (links, brand rules, price book, line grid) plus the page's fields – subject, customer organisation, TIN, phone,
 * e-mail, quote date, valid until, owner, exchange rate and the billing address. Everything is recomputed here.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertCan, hasPermission } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { brandUsers, referenceRate } from "@/server/modules/inventory/purchase-orders";
import { MAX_LINES, lineSchema, parseRules } from "./config";
import { TIN_PATTERN, canEditInvoiceRate } from "./invoice-page";
import { getDocument } from "./queries";
import { createDocument, linkDocument, saveDocument } from "./service";

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional());
const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(0).max(1e13));
const id = z.preprocess(empty, z.string().max(40).optional());

export const QUOTE_CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;

export const quotePageSchema = z.object({
  brandId: z.string().min(1, "Choose the brand"),
  regionId: id,
  ownerId: id,
  subject: text(255),
  orgName: text(200),
  orgAddress: text(400),
  orgCity: text(80),
  orgCountry: text(80),
  tinNumber: text(20).refine((v) => !v || TIN_PATTERN.test(v), "The TIN has 8 digits, a dash and 4 digits (or 10–14 digits)"),
  phone: z.string({ required_error: "Enter the phone number" }).trim().min(7, "Enter the phone number").max(40),
  email: z.string({ required_error: "Enter the e-mail address" }).trim().toLowerCase().email("Enter a valid e-mail address").max(254),
  quoteDate: z.preprocess(empty, z.coerce.date().optional()),
  validUntil: z.preprocess(empty, z.coerce.date().optional()),
  currency: z.preprocess(empty, z.enum(QUOTE_CURRENCIES).default("NGN")),
  exchangeRate: z.preprocess(empty, z.coerce.number().positive("The exchange rate must be positive").max(1e7).optional()),
  dealId: id,
  accountId: id,
  /** the customer when no account is linked */
  customerName: text(200),
  contactId: id,
  billTo: z.object({ street: text(400), city: text(80), state: text(80), country: text(80) }).partial().default({}),
  terms: text(4000),
  description: text(4000),
  lines: z.array(lineSchema).max(MAX_LINES),
  headerDiscountType: z.enum(["PERCENT", "AMOUNT"]).default("PERCENT"),
  headerDiscountValue: money,
  documentTaxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).default([]),
  adjustment: z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(-1e12).max(1e12)),
});

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the form needs for one brand: owners, deals, rates, grid settings, default terms. */
export async function quoteFormData(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const db = scopedDb(ctx);
  const { gridSettings } = await import("./lookups");
  const { getSetting } = await import("@/server/modules/setup/service");
  const [brand, owners, grid, deals, currencies] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, code: true, name: true, documentTerms: true, documentRules: true } }),
    brandUsers(ctx, brandId),
    gridSettings(ctx, brandId),
    hasPermission(ctx, "deals", "read") ? db.deal.findMany({ where: { brandId, OR: [{ stageId: null }, { stage: { type: "OPEN" } }] }, select: { id: true, name: true, accountId: true }, orderBy: { updatedAt: "desc" }, take: 100 }) : [],
    getSetting("currencies"),
  ]);
  const rules = parseRules(brand.documentRules);
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name },
    owners,
    grid,
    deals,
    settings: { terms: brand.documentTerms ?? "", requireAccount: rules.requireAccount },
    rates: { NGN: 1, ...((currencies as { rates?: Record<string, number> }).rates ?? {}) } as Record<string, number>,
    canEditRate: canEditInvoiceRate(ctx),
  };
}
export type QuoteFormData = Awaited<ReturnType<typeof quoteFormData>>;

async function defaultRegion(ctx: AccessContext, brandId: string): Promise<string | null> {
  const own = [...new Set(ctx.memberships.filter((m) => m.brandId === brandId && m.regionId).map((m) => m.regionId!))];
  if (own.length === 1) return own[0]!;
  if (own.length > 1) return null;
  const t = await scopedDb(ctx).territory.findFirst({ where: { brandId, regionId: { not: null } }, select: { regionId: true }, orderBy: { name: "asc" } });
  return t?.regionId ?? null;
}

/** Create (id = null) or change a Draft quote from the page. */
export async function saveQuotePage(ctx: AccessContext, quoteId: string | null, input: unknown) {
  const db = scopedDb(ctx);
  const before = quoteId ? await getDocument(ctx, "quote", quoteId) : null;
  const d = quotePageSchema.parse(before ? { ...(input as object), brandId: before.brandId } : input);
  if (before) {
    assertCan(ctx, "quotes", "edit", before);
    if (before.status !== "DRAFT") throw new BadRequestError("A quote can only be changed while it is a draft – revise it first");
  }
  const lines = d.lines.filter((l) => l.description.trim() || l.productId);
  if (!lines.length) throw new BadRequestError("Add at least one quoted item");
  const account = d.accountId ? await db.account.findUnique({ where: { id: d.accountId }, select: { id: true, name: true, taxId: true } }) : null;
  if (d.accountId && !account) throw new NotFoundError();
  const customerName = d.customerName ?? account?.name ?? d.orgName;
  if (!customerName) throw new BadRequestError("Enter the account name or the organisation name");
  const quoteDate = d.quoteDate ?? (before ? new Date(before.issueDate) : new Date());
  const validUntil = d.validUntil ?? new Date(quoteDate.getTime() + 14 * 86_400_000);
  if (day(validUntil) < day(quoteDate)) throw new BadRequestError("Valid until cannot be before the quote date");
  let rate = 1;
  if (d.currency !== "NGN") {
    const ref = await referenceRate(d.currency);
    rate = canEditInvoiceRate(ctx) && d.exchangeRate ? d.exchangeRate : (ref ?? 0);
    if (!(rate > 0)) throw new BadRequestError(`There is no exchange rate for ${d.currency} – set it in Setup → Currencies`);
  }
  const tin = d.tinNumber ?? account?.taxId ?? undefined;
  const party = { name: customerName, company: d.orgName ?? null, phone: d.phone, email: d.email, address: d.billTo.street ?? d.orgAddress ?? null, city: d.billTo.city ?? d.orgCity ?? null, state: d.billTo.state ?? null, taxId: tin ?? null };
  const grid = { lines, headerDiscountType: d.headerDiscountType, headerDiscountValue: d.headerDiscountValue, documentTaxes: d.documentTaxes, adjustment: d.adjustment };
  let id: string;
  if (!before) {
    const created = await createDocument(ctx, "quote", {
      brandId: d.brandId,
      regionId: d.regionId ?? (await defaultRegion(ctx, d.brandId)) ?? undefined,
      billTo: party,
      ...grid,
      issueDate: quoteDate,
      validUntil,
      currency: d.currency,
      terms: d.terms ?? undefined,
      notes: d.description ?? undefined,
      dealId: d.dealId ?? null,
      accountId: account?.id ?? null,
      contactId: d.contactId ?? null,
    });
    id = created.id;
  } else {
    id = before.id;
    await saveDocument(ctx, "quote", id, { ...grid, date: validUntil, terms: d.terms ?? null, notes: d.description ?? null, priceBookId: before.priceBookId });
    const change: Record<string, string | null> = {};
    if ((d.dealId ?? null) !== before.dealId) change.dealId = d.dealId ?? null;
    if ((account?.id ?? null) !== before.accountId) change.accountId = account?.id ?? null;
    if ((d.contactId ?? null) !== before.contactId) change.contactId = d.contactId ?? null;
    if (Object.keys(change).length) await linkDocument(ctx, "quote", id, change);
  }
  const owner = d.ownerId ?? before?.ownerId ?? ctx.userId;
  if (d.ownerId && d.ownerId !== before?.ownerId && !(await brandUsers(ctx, d.brandId)).some((u) => u.id === d.ownerId)) throw new BadRequestError("The owner has no access to this brand");
  const row = await db.quote.update({
    where: { id },
    data: {
      subject: d.subject ?? customerName,
      orgName: d.orgName ?? null,
      orgAddress: d.orgAddress ?? null,
      orgCity: d.orgCity ?? null,
      orgCountry: d.orgCountry ?? null,
      tinNumber: tin ?? null,
      phone: d.phone,
      email: d.email,
      exchangeRate: rate,
      ownerId: owner,
      issueDate: quoteDate,
      validUntil,
      billTo: { ...party, country: d.billTo.country ?? null } as Prisma.InputJsonValue,
    },
    select: { number: true },
  });
  if (before) await audit({ ctx, action: "UPDATE", entity: "Quote", entityId: id, brandId: d.brandId, before: { subject: before.quote?.subject, phone: before.quote?.phone, email: before.quote?.email }, after: { subject: d.subject ?? customerName, phone: d.phone, email: d.email } });
  return { id, number: row.number };
}
