/**
 * The "Create Sales Order" page (Zoho-style form): one save for create and edit on top of the standalone document
 * service (links, brand rules, price book, line grid) plus the page's fields – subject, customer no., customer PO,
 * pending, carrier, due date, excise, other charges, commission, exchange rate, addresses, owner – and the copy from
 * a quote. Everything is recomputed here; the charges go into the Grand Total per the brand's invoice settings.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertCan, hasPermission } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as posting from "@/server/db/inventory-posting";
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
const address = z.object({ street: text(400), city: text(80), state: text(80), code: text(20), country: text(80) }).partial().default({});

export const SO_CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;

export const orderPageSchema = z.object({
  brandId: z.string().min(1, "Choose the brand"),
  regionId: id,
  ownerId: id,
  subject: z.string({ required_error: "Enter the subject" }).trim().min(1, "Enter the subject").max(255),
  customerNo: text(60),
  quoteId: id,
  pending: text(255),
  carrier: text(60),
  salesCommission: money,
  accountId: id,
  customerName: text(200),
  otherCharges: money,
  exchangeRate: z.preprocess(empty, z.coerce.number().positive("The exchange rate must be positive").max(1e7).optional()),
  dealId: id,
  customerPoRef: text(80),
  dueDate: z.preprocess(empty, z.coerce.date().optional()),
  contactId: id,
  exciseDuty: money,
  currency: z.preprocess(empty, z.enum(SO_CURRENCIES).default("NGN")),
  phone: text(40),
  tinNumber: text(20).refine((v) => !v || TIN_PATTERN.test(v), "The TIN has 8 digits, a dash and 4 digits (or 10–14 digits)"),
  billTo: address,
  shipTo: address,
  terms: text(4000),
  description: text(4000),
  lines: z.array(lineSchema).max(MAX_LINES),
  headerDiscountType: z.enum(["PERCENT", "AMOUNT"]).default("PERCENT"),
  headerDiscountValue: money,
  documentTaxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).default([]),
  adjustment: z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(-1e12).max(1e12)),
});

/** Quotes of the brand a sales order can follow (approved, sent or accepted). */
async function openQuotes(ctx: AccessContext, brandId: string) {
  if (!hasPermission(ctx, "quotes", "read")) return [];
  const rows = await scopedDb(ctx).quote.findMany({ where: { brandId, deletedAt: null, status: { in: ["APPROVED", "SENT", "ACCEPTED"] } }, select: { id: true, number: true, subject: true, billTo: true, status: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((q) => ({ id: q.id, number: q.number, label: `${q.number}${q.subject ? ` – ${q.subject}` : ""}`, customer: ((q.billTo as { name?: string } | null)?.name ?? "") as string, status: q.status }));
}

/** Everything the form needs for one brand. */
export async function orderFormData(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const db = scopedDb(ctx);
  const { gridSettings } = await import("./lookups");
  const { getSetting } = await import("@/server/modules/setup/service");
  const [brand, owners, grid, quotes, deals, inv, currencies] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, code: true, name: true, documentTerms: true, documentRules: true } }),
    brandUsers(ctx, brandId),
    gridSettings(ctx, brandId),
    openQuotes(ctx, brandId),
    hasPermission(ctx, "deals", "read") ? db.deal.findMany({ where: { brandId, OR: [{ stageId: null }, { stage: { type: "OPEN" } }] }, select: { id: true, name: true, accountId: true }, orderBy: { updatedAt: "desc" }, take: 100 }) : [],
    posting.brandSettings(brandId),
    getSetting("currencies"),
  ]);
  const rules = parseRules(brand.documentRules);
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name },
    owners,
    grid,
    quotes,
    deals,
    settings: { terms: brand.documentTerms ?? "", carriers: inv.carriers.length ? inv.carriers : ["Other"], exciseInTotal: rules.exciseInTotal, otherChargesEnabled: rules.otherChargesEnabled, requireAccount: rules.requireAccount, requireQuoteBeforeOrder: rules.requireQuoteBeforeOrder },
    rates: { NGN: 1, ...((currencies as { rates?: Record<string, number> }).rates ?? {}) } as Record<string, number>,
    canEditRate: canEditInvoiceRate(ctx),
  };
}
export type OrderFormData = Awaited<ReturnType<typeof orderFormData>>;

/** "Copy details and items from QT-…?": customer, contact, deal, phone, TIN, addresses, currency, terms and the lines. */
export async function quoteForOrder(ctx: AccessContext, quoteId: string) {
  const q = await getDocument(ctx, "quote", quoteId);
  const account = q.accountId ? await scopedDb(ctx).account.findUnique({ where: { id: q.accountId }, select: { id: true, name: true, type: true, taxId: true } }) : null;
  const contact = q.contactId ? await scopedDb(ctx).contact.findUnique({ where: { id: q.contactId }, select: { id: true, firstName: true, lastName: true } }) : null;
  const b = q.billTo ?? {};
  return {
    id: q.id,
    number: q.number,
    subject: q.quote?.subject ?? null,
    account: account ? { id: account.id, name: account.name, type: account.type } : null,
    customerName: b.name ?? account?.name ?? "",
    contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") } : null,
    dealId: q.dealId,
    dealName: q.dealName,
    phone: q.quote?.phone ?? b.phone ?? "",
    tinNumber: q.quote?.tinNumber ?? b.taxId ?? account?.taxId ?? "",
    currency: q.currency,
    terms: q.terms ?? "",
    billTo: { street: b.address ?? "", city: b.city ?? "", state: b.state ?? "", country: "Nigeria" },
    headerDiscountType: q.headerDiscountType,
    headerDiscountValue: q.headerDiscountValue,
    documentTaxes: q.documentTaxes.map(({ name, rate }) => ({ name, rate })),
    lines: q.lines,
  };
}

async function defaultRegion(ctx: AccessContext, brandId: string): Promise<string | null> {
  const own = [...new Set(ctx.memberships.filter((m) => m.brandId === brandId && m.regionId).map((m) => m.regionId!))];
  if (own.length === 1) return own[0]!;
  if (own.length > 1) return null;
  const t = await scopedDb(ctx).territory.findFirst({ where: { brandId, regionId: { not: null } }, select: { regionId: true }, orderBy: { name: "asc" } });
  return t?.regionId ?? null;
}

/** Create (id = null) or change a Created (draft) sales order from the page. */
export async function saveOrderPage(ctx: AccessContext, orderId: string | null, input: unknown) {
  const db = scopedDb(ctx);
  const before = orderId ? await getDocument(ctx, "salesOrder", orderId) : null;
  const d = orderPageSchema.parse(before ? { ...(input as object), brandId: before.brandId } : input);
  if (before) {
    assertCan(ctx, "salesOrders", "edit", before);
    if (before.status !== "DRAFT") throw new BadRequestError("A sales order can only be changed while it is Created – a Brand Manager can reopen a confirmed one");
  }
  const lines = d.lines.filter((l) => l.description.trim() || l.productId);
  if (!lines.length) throw new BadRequestError("Add at least one ordered item");
  const account = d.accountId ? await db.account.findUnique({ where: { id: d.accountId }, select: { id: true, name: true, taxId: true } }) : null;
  if (d.accountId && !account) throw new NotFoundError();
  const customerName = d.customerName ?? account?.name;
  if (!customerName) throw new BadRequestError("Enter the account name – pick an account or type the customer's name");
  const settings = await posting.brandSettings(d.brandId);
  if (d.carrier && !settings.carriers.includes(d.carrier)) throw new BadRequestError("Choose a carrier from the list");
  let rate = 1;
  if (d.currency !== "NGN") {
    const ref = await referenceRate(d.currency);
    rate = canEditInvoiceRate(ctx) && d.exchangeRate ? d.exchangeRate : (ref ?? 0);
    if (!(rate > 0)) throw new BadRequestError(`There is no exchange rate for ${d.currency} – set it in Setup → Currencies`);
  }
  const tin = d.tinNumber ?? account?.taxId ?? undefined;
  const party = { name: customerName, phone: d.phone ?? null, address: d.billTo.street ?? null, city: d.billTo.city ?? null, state: d.billTo.state ?? null, taxId: tin ?? null };
  const grid = { lines, headerDiscountType: d.headerDiscountType, headerDiscountValue: d.headerDiscountValue, documentTaxes: d.documentTaxes, adjustment: d.adjustment };
  let soId: string;
  if (!before) {
    const created = await createDocument(ctx, "salesOrder", {
      brandId: d.brandId,
      regionId: d.regionId ?? (await defaultRegion(ctx, d.brandId)) ?? undefined,
      billTo: party,
      shipTo: { name: customerName, address: d.shipTo.street ?? null, city: d.shipTo.city ?? null, state: d.shipTo.state ?? null },
      ...grid,
      currency: d.currency,
      terms: d.terms ?? undefined,
      notes: d.description ?? undefined,
      dealId: d.dealId ?? null,
      accountId: account?.id ?? null,
      contactId: d.contactId ?? null,
      sourceDocumentId: d.quoteId ?? null,
    });
    soId = created.id;
  } else {
    soId = before.id;
    await saveDocument(ctx, "salesOrder", soId, { ...grid, terms: d.terms ?? null, notes: d.description ?? null, priceBookId: before.priceBookId });
    const change: Record<string, string | null> = {};
    if ((d.dealId ?? null) !== before.dealId) change.dealId = d.dealId ?? null;
    if ((account?.id ?? null) !== before.accountId) change.accountId = account?.id ?? null;
    if ((d.contactId ?? null) !== before.contactId) change.contactId = d.contactId ?? null;
    if ((d.quoteId ?? null) !== before.sourceDocumentId) change.sourceDocumentId = d.quoteId ?? null;
    if (Object.keys(change).length) await linkDocument(ctx, "salesOrder", soId, change);
  }
  if (d.ownerId && d.ownerId !== before?.ownerId && !(await brandUsers(ctx, d.brandId)).some((u) => u.id === d.ownerId)) throw new BadRequestError("The owner has no access to this brand");
  // the stored total includes the charges stored so far – replace them with the new ones
  const { chargesInTotal } = await import("./lines");
  const row = await db.salesOrder.findUniqueOrThrow({ where: { id: soId }, select: { total: true, number: true } });
  const gridTotal = Number(row.total) - (await chargesInTotal(db, "salesOrder", soId, d.brandId));
  const rules = parseRules((await db.brand.findUnique({ where: { id: d.brandId }, select: { documentRules: true } }))?.documentRules);
  const other = rules.otherChargesEnabled ? d.otherCharges : 0;
  const total = Math.round((gridTotal + other + (rules.exciseInTotal ? d.exciseDuty : 0)) * 100) / 100;
  await db.salesOrder.update({
    where: { id: soId },
    data: {
      subject: d.subject,
      customerNo: d.customerNo ?? null,
      customerPoRef: d.customerPoRef ?? null,
      pending: d.pending ?? null,
      carrier: d.carrier ?? null,
      dueDate: d.dueDate ?? null,
      phone: d.phone ?? null,
      tinNumber: tin ?? null,
      exchangeRate: rate,
      exciseDuty: d.exciseDuty,
      otherCharges: other,
      salesCommission: d.salesCommission,
      ownerId: d.ownerId ?? before?.ownerId ?? ctx.userId,
      total,
      billTo: { ...party, code: d.billTo.code ?? null, country: d.billTo.country ?? null } as Prisma.InputJsonValue,
      shipTo: { name: customerName, address: d.shipTo.street ?? null, city: d.shipTo.city ?? null, state: d.shipTo.state ?? null, code: d.shipTo.code ?? null, country: d.shipTo.country ?? null } as Prisma.InputJsonValue,
    },
  });
  if (before) await audit({ ctx, action: "UPDATE", entity: "SalesOrder", entityId: soId, brandId: d.brandId, before: { subject: before.order?.subject, total: before.total }, after: { subject: d.subject, total } });
  return { id: soId, number: row.number };
}
