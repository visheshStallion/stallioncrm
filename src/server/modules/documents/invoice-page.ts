/**
 * The "Create Invoice" page (prompt 26): one save for create and edit on top of the standalone document service
 * (links, brand rules, price book, the shared line grid), plus the page's header fields – subject, customer PO, TIN,
 * phone, excise, other charges, commission, exchange rate, addresses, owner, form view – the copy from a sales order
 * with partial quantities, and the Grand Total with the brand's charges rules. Everything is recomputed here.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { managedBrands } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { brandUsers, referenceRate } from "@/server/modules/inventory/purchase-orders";
import { MAX_LINES, lineSchema, parseRules } from "./config";
import { getDocument } from "./queries";
import { createDocument, linkDocument, rulesOf, saveDocument } from "./service";

export const INVOICE_CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional());
const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(0).max(1e13));
const id = z.preprocess(empty, z.string().max(40).optional());
const address = z.object({ street: text(400), city: text(80), state: text(80), code: text(20), country: text(80) }).partial().default({});
/** FIRS TIN: 8 digits, a dash and 4 digits – or the 10–14 digit forms */
export const TIN_PATTERN = /^(\d{8}-\d{4}|\d{10,14})$/;

export const invoicePageSchema = z.object({
  brandId: z.string().min(1, "Choose the brand"),
  regionId: id,
  ownerId: id,
  subject: z.string({ required_error: "Enter the subject" }).trim().min(1, "Enter the subject").max(255),
  customerPoRef: text(80),
  invoiceDate: z.preprocess(empty, z.coerce.date().optional()),
  dueDate: z.preprocess(empty, z.coerce.date().optional()),
  salesCommission: money,
  exciseDuty: money,
  otherCharges: money,
  tinNumber: text(20).refine((v) => !v || TIN_PATTERN.test(v), "The TIN has 8 digits, a dash and 4 digits (or 10–14 digits)"),
  currency: z.preprocess(empty, z.enum(INVOICE_CURRENCIES).default("NGN")),
  exchangeRate: z.preprocess(empty, z.coerce.number().positive("The exchange rate must be positive").max(1e7).optional()),
  accountId: id,
  /** the customer when no account is linked (the bill-to snapshot) */
  customerName: text(200),
  contactId: id,
  phone: text(40),
  email: z.preprocess(empty, z.string().trim().toLowerCase().email("Enter a valid e-mail address").max(254).optional()),
  dealId: id,
  salesOrderId: id,
  billTo: address,
  shipTo: address,
  terms: text(4000),
  description: text(4000),
  formViewId: text(40),
  lines: z.array(lineSchema.extend({ sourceLineId: id })).max(MAX_LINES),
  headerDiscountType: z.enum(["PERCENT", "AMOUNT"]).default("PERCENT"),
  headerDiscountValue: money,
  documentTaxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).default([]),
  adjustment: z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(-1e12).max(1e12)),
});
export type InvoicePageInput = z.input<typeof invoicePageSchema>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const canEditInvoiceRate = (ctx: AccessContext) => !!ctx.isAdmin || hasPermission(ctx, "inventoryFinance", "edit");
export const canDesignInvoiceForm = (ctx: AccessContext, brandId: string) => !!ctx.isAdmin || !!ctx.brandAdminOf?.includes(brandId);

/** The open sales orders of the brand that still have quantities to invoice (the Sales Order lookup). */
export async function openOrdersForInvoice(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId) || !hasPermission(ctx, "salesOrders", "read")) return [];
  const rows = await scopedDb(ctx).salesOrder.findMany({
    where: { brandId, deletedAt: null, status: { in: ["CONFIRMED", "ALLOCATED", "DELIVERED"] } },
    select: { id: true, number: true, billTo: true, total: true, currency: true, lines: { select: { qty: true, invoicedQty: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows
    .filter((o) => o.lines.some((l) => Number(l.qty) - Number(l.invoicedQty) > 1e-9))
    .map((o) => ({ id: o.id, number: o.number, customer: ((o.billTo as { name?: string } | null)?.name ?? "") as string, total: Number(o.total), currency: o.currency }));
}

/** "Copy details and items from SO-…?": header, addresses and only the lines (quantities) not invoiced yet. */
export async function orderForInvoice(ctx: AccessContext, orderId: string) {
  const o = await getDocument(ctx, "salesOrder", orderId);
  if (!["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(o.status)) throw new BadRequestError("Only confirmed sales orders can be invoiced");
  const db = scopedDb(ctx);
  const [account, contact] = await Promise.all([
    o.accountId ? db.account.findUnique({ where: { id: o.accountId }, select: { id: true, name: true, type: true, taxId: true, phone: true } }) : null,
    o.contactId ? db.contact.findUnique({ where: { id: o.contactId }, select: { id: true, firstName: true, lastName: true, mobile: true } }) : null,
  ]);
  const b = o.billTo ?? {};
  const s = o.shipTo ?? {};
  const lines = o.lines
    .map((l) => ({ l, left: Math.round((l.qty - l.invoicedQty) * 100) / 100 }))
    .filter((x) => x.left > 0)
    .map(({ l, left }) => ({ ...l, qty: left, vins: l.vins.slice(0, Math.ceil(left)), sourceLineId: l.id }));
  return {
    id: o.id,
    number: o.number,
    brandId: o.brandId,
    account: account ? { id: account.id, name: account.name, type: account.type, taxId: account.taxId } : null,
    customerName: b.name ?? account?.name ?? "",
    contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") } : null,
    dealId: o.dealId,
    dealName: o.dealName,
    phone: b.phone ?? contact?.mobile ?? account?.phone ?? "",
    tinNumber: b.taxId ?? account?.taxId ?? "",
    currency: o.currency,
    terms: o.terms ?? "",
    billTo: { street: b.address ?? "", city: b.city ?? "", state: b.state ?? "", country: "Nigeria" },
    shipTo: { street: s.address ?? b.address ?? "", city: s.city ?? b.city ?? "", state: s.state ?? b.state ?? "", country: "Nigeria" },
    headerDiscountType: o.headerDiscountType,
    headerDiscountValue: o.headerDiscountValue,
    documentTaxes: o.documentTaxes.map(({ name, rate }) => ({ name, rate })),
    adjustment: 0,
    lines,
  };
}

/** Accounts the user can see, by name (the Account Name lookup). */
export async function searchAccounts(ctx: AccessContext, q: string) {
  if (!hasPermission(ctx, "accounts", "read")) return [];
  const t = q.trim();
  return scopedDb(ctx).account.findMany({
    where: t ? { name: { contains: t, mode: "insensitive" } } : {},
    select: { id: true, name: true, type: true, taxId: true, phone: true, email: true, address: true, city: true, state: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}
/** Contacts of an account (the Contact Name lookup) and deals of the brand for the account (Deal Name lookup). */
export async function accountLinks(ctx: AccessContext, brandId: string, accountId: string | null) {
  const db = scopedDb(ctx);
  const [contacts, deals] = await Promise.all([
    accountId && hasPermission(ctx, "contacts", "read") ? db.contact.findMany({ where: { accountId }, select: { id: true, firstName: true, lastName: true, mobile: true, email: true, address: true, city: true }, orderBy: { lastName: "asc" }, take: 100 }) : [],
    hasPermission(ctx, "deals", "read") ? db.deal.findMany({ where: { brandId, ...(accountId ? { accountId } : {}) }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 50 }) : [],
  ]);
  return { contacts: contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: c.mobile, email: c.email, address: c.address, city: c.city })), deals };
}

/** Everything the form needs for one brand. */
export async function invoiceFormData(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const db = scopedDb(ctx);
  const { gridSettings } = await import("./lookups");
  const { getSetting } = await import("@/server/modules/setup/service");
  const [brand, owners, grid, orders, currencies] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, code: true, name: true, documentTerms: true, documentRules: true } }),
    brandUsers(ctx, brandId),
    gridSettings(ctx, brandId),
    openOrdersForInvoice(ctx, brandId),
    getSetting("currencies"),
  ]);
  const rules = parseRules(brand.documentRules);
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name },
    owners,
    grid,
    orders,
    settings: { terms: brand.documentTerms ?? "", paymentTermsDays: rules.paymentTermsDays, tinRequiredB2B: rules.tinRequiredB2B, exciseInTotal: rules.exciseInTotal, otherChargesEnabled: rules.otherChargesEnabled, requireAccount: rules.requireAccount, formViews: rules.invoiceFormViews },
    rates: { NGN: 1, ...((currencies as { rates?: Record<string, number> }).rates ?? {}) } as Record<string, number>,
    canEditRate: canEditInvoiceRate(ctx),
  };
}
export type InvoiceFormData = Awaited<ReturnType<typeof invoiceFormData>>;

/**
 * The region of a new invoice without a deal: the user's only region for the brand, else the brand's first region
 * (group-wide users such as administrators have none of their own).
 */
async function defaultRegion(ctx: AccessContext, brandId: string): Promise<string | null> {
  const own = [...new Set(ctx.memberships.filter((m) => m.brandId === brandId && m.regionId).map((m) => m.regionId!))];
  if (own.length === 1) return own[0]!;
  if (own.length > 1) return null;
  const t = await scopedDb(ctx).territory.findFirst({ where: { brandId, regionId: { not: null } }, select: { regionId: true }, orderBy: { name: "asc" } });
  return t?.regionId ?? null;
}

/** Create (id = null) or change a Created invoice from the page. */
export async function saveInvoicePage(ctx: AccessContext, id: string | null, input: unknown) {
  const db = scopedDb(ctx);
  const before = id ? await getDocument(ctx, "invoice", id) : null;
  const d = invoicePageSchema.parse(before ? { ...(input as object), brandId: before.brandId } : input);
  if (before) {
    assertCan(ctx, "invoices", "edit", before);
    if (before.status !== "DRAFT") throw new BadRequestError("An invoice can only be changed while it is Created – after issuing, correct it with a credit note");
  }
  const rules = await rulesOf(ctx, d.brandId);
  const lines = d.lines.filter((l) => l.description.trim() || l.productId);
  if (!lines.length || !lines.some((l) => l.qty > 0)) throw new BadRequestError("Add at least one invoiced item with a quantity");

  // the customer: a linked account, or a typed name (the bill-to snapshot)
  const account = d.accountId ? await db.account.findUnique({ where: { id: d.accountId }, select: { id: true, name: true, type: true, taxId: true } }) : null;
  if (d.accountId && !account) throw new NotFoundError();
  const customerName = d.customerName ?? account?.name;
  if (!customerName) throw new BadRequestError("Enter the account name – pick an account or type the customer's name");
  if (rules.requireAccount && !account) throw new ForbiddenError("This brand requires a linked account on its invoices");
  if (d.contactId) {
    const c = await db.contact.findUnique({ where: { id: d.contactId }, select: { accountId: true } });
    if (!c) throw new NotFoundError();
    if (account && c.accountId && c.accountId !== account.id) throw new BadRequestError("The contact belongs to another account");
  }
  const tin = d.tinNumber ?? account?.taxId ?? undefined;
  if (rules.tinRequiredB2B && account && account.type !== "INDIVIDUAL" && !tin) throw new BadRequestError("This brand requires the customer's TIN on invoices to companies");

  // dates: due = invoice date + the brand's payment terms unless typed; never before the invoice date
  const invoiceDate = d.invoiceDate ?? (before ? new Date(before.issueDate) : new Date());
  const dueDate = d.dueDate ?? plusDays(invoiceDate, rules.paymentTermsDays);
  if (day(dueDate) < day(invoiceDate)) throw new BadRequestError("The due date cannot be before the invoice date");

  // currency and rate
  let rate = 1;
  if (d.currency !== "NGN") {
    const ref = await referenceRate(d.currency);
    rate = canEditInvoiceRate(ctx) && d.exchangeRate ? d.exchangeRate : (ref ?? 0);
    if (!(rate > 0)) throw new BadRequestError(`There is no exchange rate for ${d.currency} – set it in Setup → Currencies`);
  }

  // the sales order: same brand; per order line at most what is still to invoice
  const orderId = d.salesOrderId ?? null;
  const order = orderId ? await getDocument(ctx, "salesOrder", orderId) : null;
  if (order && order.brandId !== d.brandId) throw new ForbiddenError("The sales order belongs to another brand");
  if (order && !["CONFIRMED", "ALLOCATED", "DELIVERED"].includes(order.status)) throw new BadRequestError("Only confirmed sales orders can be invoiced");
  const mine = new Map<string, number>(); // what this invoice had invoiced already (edit)
  for (const l of before?.lines ?? []) if (l.sourceLineId) mine.set(l.sourceLineId, (mine.get(l.sourceLineId) ?? 0) + l.qty);
  const want = new Map<string, number>();
  for (const l of lines) if (l.sourceLineId) want.set(l.sourceLineId, (want.get(l.sourceLineId) ?? 0) + l.qty);
  if (want.size && !order) throw new BadRequestError("Lines copied from a sales order need the sales order");
  for (const [lineId, q] of want) {
    const src = order!.lines.find((l) => l.id === lineId);
    if (!src) throw new BadRequestError("A copied line does not belong to the sales order");
    const left = src.qty - src.invoicedQty + (mine.get(lineId) ?? 0);
    if (q > left + 1e-9) throw new BadRequestError(`“${src.description}”: at most ${Math.round(left * 100) / 100} can still be invoiced`);
  }

  const party = { name: customerName, phone: d.phone ?? null, email: d.email ?? null, address: d.billTo.street ?? null, city: d.billTo.city ?? null, state: d.billTo.state ?? null, taxId: tin ?? null };
  const grid = { lines: lines.map(({ sourceLineId: _s, ...l }) => l), headerDiscountType: d.headerDiscountType, headerDiscountValue: d.headerDiscountValue, documentTaxes: d.documentTaxes, adjustment: d.adjustment };
  let invoiceId: string;
  if (!before) {
    const created = await createDocument(ctx, "invoice", {
      brandId: d.brandId,
      regionId: d.regionId ?? (await defaultRegion(ctx, d.brandId)) ?? undefined,
      billTo: party,
      shipTo: { name: customerName, address: d.shipTo.street ?? null, city: d.shipTo.city ?? null, state: d.shipTo.state ?? null },
      ...grid,
      issueDate: invoiceDate,
      dueDate,
      currency: d.currency,
      terms: d.terms ?? undefined,
      notes: d.description ?? undefined,
      dealId: d.dealId ?? null,
      accountId: account?.id ?? null,
      contactId: d.contactId ?? null,
      sourceDocumentId: orderId,
    });
    invoiceId = created.id;
  } else {
    invoiceId = before.id;
    await saveDocument(ctx, "invoice", invoiceId, { ...grid, date: dueDate, terms: d.terms ?? null, notes: d.description ?? null, priceBookId: before.priceBookId });
    const change: Record<string, string | null> = {};
    if ((d.dealId ?? null) !== before.dealId) change.dealId = d.dealId ?? null;
    if ((account?.id ?? null) !== before.accountId) change.accountId = account?.id ?? null;
    if ((d.contactId ?? null) !== before.contactId) change.contactId = d.contactId ?? null;
    if (orderId !== before.sourceDocumentId) change.sourceDocumentId = orderId;
    if (Object.keys(change).length) await linkDocument(ctx, "invoice", invoiceId, change);
  }

  // copied lines remember their order line; the order's invoiced quantities follow (edit: undo, then apply)
  const stored = await db.documentLine.findMany({ where: { invoiceId }, orderBy: { position: "asc" }, select: { id: true } });
  for (const [i, l] of lines.entries()) if (stored[i]) await db.documentLine.update({ where: { id: stored[i]!.id }, data: { sourceLineId: l.sourceLineId ?? null } });
  for (const [lineId, q] of mine) await db.documentLine.updateMany({ where: { id: lineId, salesOrderId: { not: null } }, data: { invoicedQty: { decrement: q } } });
  for (const [lineId, q] of want) await db.documentLine.updateMany({ where: { id: lineId, salesOrderId: { not: null } }, data: { invoicedQty: { increment: q } } });

  // header fields of the page and the Grand Total with the brand's charges rules
  const row = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { total: true, number: true } });
  // the stored total includes the charges stored so far (create: none) – replace them with the new ones
  const { chargesInTotal } = await import("./lines");
  const gridTotal = Number(row.total) - (await chargesInTotal(db, "invoice", invoiceId, d.brandId));
  const other = rules.otherChargesEnabled ? d.otherCharges : 0;
  const total = Math.round((gridTotal + other + (rules.exciseInTotal ? d.exciseDuty : 0)) * 100) / 100;
  const owner = d.ownerId ?? before?.ownerId ?? ctx.userId;
  if (d.ownerId && d.ownerId !== before?.ownerId && !(await brandUsers(ctx, d.brandId)).some((u) => u.id === d.ownerId)) throw new BadRequestError("The owner has no access to this brand");
  const views = rules.invoiceFormViews;
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      subject: d.subject,
      customerPoRef: d.customerPoRef ?? null,
      tinNumber: tin ?? null,
      phone: d.phone ?? null,
      exchangeRate: rate,
      exciseDuty: d.exciseDuty,
      otherCharges: other,
      salesCommission: d.salesCommission,
      formViewId: d.formViewId && views.some((v) => v.id === d.formViewId) ? d.formViewId : null,
      ownerId: owner,
      issueDate: invoiceDate,
      dueDate,
      total,
      billTo: { ...party, code: d.billTo.code ?? null, country: d.billTo.country ?? null } as Prisma.InputJsonValue,
      shipTo: { name: customerName, address: d.shipTo.street ?? null, city: d.shipTo.city ?? null, state: d.shipTo.state ?? null, code: d.shipTo.code ?? null, country: d.shipTo.country ?? null } as Prisma.InputJsonValue,
    },
  });
  if (before) await audit({ ctx, action: "UPDATE", entity: "Invoice", entityId: invoiceId, brandId: d.brandId, before: { subject: before.invoice?.subject, total: before.total }, after: { subject: d.subject, total } });
  return { id: invoiceId, number: row.number };
}

/** Setup → Invoices: payment terms, TIN rule, charges in the total and the custom form views (Admin / Brand Admin). */
export async function saveInvoiceSettings(ctx: AccessContext, brandId: string, input: { paymentTermsDays: unknown; tinRequiredB2B: boolean; exciseInTotal: boolean; otherChargesEnabled: boolean }) {
  if (!canDesignInvoiceForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins manage invoice settings");
  const store = await import("@/server/db/document-rules-store");
  const current = parseRules((await store.brandRules(brandId)).documentRules);
  const next = parseRules({ ...current, paymentTermsDays: input.paymentTermsDays, tinRequiredB2B: input.tinRequiredB2B, exciseInTotal: input.exciseInTotal, otherChargesEnabled: input.otherChargesEnabled });
  await store.writeBrandRules(brandId, next as unknown as Prisma.InputJsonValue);
  await audit({ ctx, action: "UPDATE", entity: "Brand", entityId: brandId, brandId, before: { paymentTermsDays: current.paymentTermsDays, tinRequiredB2B: current.tinRequiredB2B, exciseInTotal: current.exciseInTotal, otherChargesEnabled: current.otherChargesEnabled }, after: { paymentTermsDays: next.paymentTermsDays, tinRequiredB2B: next.tinRequiredB2B, exciseInTotal: next.exciseInTotal, otherChargesEnabled: next.otherChargesEnabled } });
}

export const INVOICE_FORM_PARTS = {
  customerPoRef: "Purchase Order",
  exciseDuty: "Excise Duty",
  tinNumber: "TIN Number",
  salesCommission: "Sales Commission",
  dealId: "Deal Name",
  otherCharges: "Add Other Charges",
  address: "Address Information",
  terms: "Terms and Conditions",
  description: "Description Information",
} as const;

export async function saveInvoiceFormView(ctx: AccessContext, brandId: string, input: { id?: string | null; name: string; hidden: string[] }) {
  if (!canDesignInvoiceForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins design form views");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new BadRequestError("Give the view a name (2–60 characters)");
  const store = await import("@/server/db/document-rules-store");
  const rules = parseRules((await store.brandRules(brandId)).documentRules);
  if (rules.invoiceFormViews.some((v) => v.name.toLowerCase() === name.toLowerCase() && v.id !== input.id)) throw new BadRequestError("A view with this name exists");
  const viewId = input.id && rules.invoiceFormViews.some((v) => v.id === input.id) ? input.id : `iv${Date.now().toString(36)}`;
  const hidden = input.hidden.filter((h) => h in INVOICE_FORM_PARTS);
  const views = [...rules.invoiceFormViews.filter((v) => v.id !== viewId), { id: viewId, name, hidden }];
  await store.writeBrandRules(brandId, { ...rules, invoiceFormViews: views } as unknown as Prisma.InputJsonValue);
  await audit({ ctx, action: input.id ? "UPDATE" : "CREATE", entity: "Brand", entityId: brandId, brandId, after: { invoiceFormView: { id: viewId, name, hidden } } });
  return { id: viewId };
}
export async function deleteInvoiceFormView(ctx: AccessContext, brandId: string, viewId: string) {
  if (!canDesignInvoiceForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins design form views");
  const store = await import("@/server/db/document-rules-store");
  const rules = parseRules((await store.brandRules(brandId)).documentRules);
  await store.writeBrandRules(brandId, { ...rules, invoiceFormViews: rules.invoiceFormViews.filter((v) => v.id !== viewId) } as unknown as Prisma.InputJsonValue);
  await audit({ ctx, action: "DELETE", entity: "Brand", entityId: brandId, brandId, before: { invoiceFormView: viewId } });
}

/** Managers (for the record page): the brand manager or an administrator. */
export const isInvoiceManager = (ctx: AccessContext, brandId: string) => !!ctx.isAdmin || managedBrands(ctx).includes(brandId);
