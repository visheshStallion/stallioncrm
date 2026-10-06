/**
 * The "Create Purchase Order" page (prompt 25): a PO is an inventory document of type PO (receiving, costing and
 * the vendor bill keep working on it) with the page's header fields and the Purchase Items grid of prompt 24.
 * Everything the page shows is recomputed here – brand of every reference, totals in kobo, exchange rate, approval.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as posting from "@/server/db/inventory-posting";
import { BadRequestError } from "@/server/errors";
import { calcDocument, type TaxRate } from "@/server/modules/documents/calc";
import { MAX_LINES, lineSchema as gridLineSchema } from "@/server/modules/documents/config";
import type { GridProduct } from "@/server/modules/documents/lookups";

import { PO_CURRENCIES, PO_FORM_PARTS, PO_STATUS_LABELS, type PoFormPart, type PoFormView } from "./po-config";

export { NIGERIAN_STATES, PO_CURRENCIES, PO_FORM_PARTS, PO_STATUS_LABELS, type PoFormPart, type PoFormView } from "./po-config";

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
const text = (max: number) => z.preprocess(empty, z.string().trim().max(max).optional());
const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(0).max(1e13));
const address = z
  .object({ street: text(300), city: text(100), state: text(100), code: text(20), country: text(100) })
  .partial()
  .default({});

export const poSchema = z.object({
  brandId: z.string().min(1, "Choose the brand"),
  ownerId: z.preprocess(empty, z.string().max(40).optional()),
  /** a typed PO number (only when the brand allows it) */
  number: text(60),
  subject: z.string({ required_error: "Enter the subject" }).trim().min(1, "Enter the subject").max(255),
  requisitionNumber: text(80),
  vendorId: z.string({ required_error: "Choose the vendor" }).min(1, "Choose the vendor"),
  vendorContactId: z.preprocess(empty, z.string().max(40).optional()),
  trackingNumber: text(120),
  poDate: z.preprocess(empty, z.coerce.date().optional()),
  dueDate: z.preprocess(empty, z.coerce.date().optional()),
  carrier: text(60),
  exciseDuty: money,
  salesCommission: money,
  currency: z.preprocess(empty, z.enum(PO_CURRENCIES).default("NGN")),
  exchangeRate: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().positive("The exchange rate must be positive").max(1e7).optional()),
  billTo: address,
  shipTo: address,
  warehouseId: z.preprocess(empty, z.string().max(40).optional()),
  terms: text(5000),
  description: text(5000),
  formViewId: text(40),
  lines: z.array(gridLineSchema.extend({ expectedVins: z.array(z.string().trim().toUpperCase().min(5).max(40)).max(500).optional() })).max(MAX_LINES),
  headerDiscountType: z.enum(["PERCENT", "AMOUNT"]).default("PERCENT"),
  headerDiscountValue: money,
  documentTaxes: z.array(z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) })).max(5).default([]),
  adjustment: z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number().min(-1e13).max(1e13)),
});
export type PoInput = z.input<typeof poSchema>;

const num = (d: { toString(): string } | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
const day = (d: Date) => d.toISOString().slice(0, 10);

function assertBrand(ctx: AccessContext, action: "create" | "edit", brandId: string) {
  if (!hasPermission(ctx, "inventory", action)) throw new ForbiddenError(`You do not have ${action} permission on purchase orders`);
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new ForbiddenError("You cannot work on this brand's purchase orders");
}
/** Who sees costs (prices on a PO) and who may type an exchange rate. */
export const canSeeCost = (ctx: AccessContext) => hasPermission(ctx, "inventoryFinance", "read");
export const canEditRate = (ctx: AccessContext) => hasPermission(ctx, "inventoryFinance", "edit");
/** Edit Page Layout / Create a custom form page: administrators and Brand Admins. */
export const canDesignForm = (ctx: AccessContext, brandId: string) => !!ctx.isAdmin || !!ctx.brandAdminOf?.includes(brandId);

/** Users who may own a PO of the brand: group-wide users and members of a territory of the brand. */
export async function brandUsers(ctx: AccessContext, brandId: string) {
  return scopedDb(ctx).user.findMany({
    where: { active: true, OR: [{ profile: { scope: "ALL" } }, { memberships: { some: { territory: { brandId } } } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Reference rate from Setup → Currencies (units of NGN for one unit of the currency). */
export async function referenceRate(currency: string): Promise<number | null> {
  if (currency === "NGN") return 1;
  const { getSetting } = await import("@/server/modules/setup/service");
  const c = (await getSetting("currencies")) as { rates?: Record<string, number> };
  return c.rates?.[currency] ?? null;
}

export async function poSettings(ctx: AccessContext, brandId: string) {
  const s = await posting.brandSettings(brandId);
  return {
    terms: s.poTerms ?? "",
    addExciseToTotal: s.addExciseToTotal,
    allowManualNumber: s.allowManualPoNumber,
    receivingWarehouseId: s.receivingWarehouseId,
    carriers: s.carriers.length ? s.carriers : ["Other"],
    formViews: (Array.isArray(s.poFormViews) ? s.poFormViews : []) as unknown as PoFormView[],
    approvalLimit: num(s.poApprovalLimit),
  };
}

/**
 * Products for the Purchase Items grid. List Price = purchase price: the last price paid to this vendor, else the
 * product's cost price, else empty (typed by hand). Users without cost access get no prices.
 */
export async function poProducts(ctx: AccessContext, brandId: string, vendorId: string | null): Promise<Array<GridProduct & { fromVendor: boolean }>> {
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (!hasPermission(ctx, "inventory", "read")) return [];
  const db = scopedDb(ctx);
  const cost = canSeeCost(ctx);
  const products = await db.product.findMany({ where: { brandId, active: true }, select: { id: true, name: true, code: true, category: true, costPrice: true, uom: true, taxRatePct: true, preferredVendorId: true }, orderBy: { name: "asc" }, take: 500 });
  const last = new Map<string, number>();
  if (vendorId) {
    const lines = await db.inventoryDocumentLine.findMany({ where: { productId: { not: null }, document: { brandId, type: "PO", vendorId, status: { not: "CANCELLED" } } }, select: { productId: true, unitCost: true, document: { select: { docDate: true } } }, orderBy: { document: { docDate: "desc" } }, take: 1000 });
    for (const l of lines) if (l.productId && !last.has(l.productId)) last.set(l.productId, num(l.unitCost));
  }
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    category: p.category,
    price: cost ? (last.get(p.id) ?? (p.costPrice === null ? null : num(p.costPrice))) : null,
    taxRatePct: num(p.taxRatePct),
    maxDiscountPct: null,
    vehicle: p.category === "VEHICLE",
    uom: p.uom,
    stock: null,
    fromVendor: !!vendorId && (p.preferredVendorId === vendorId || last.has(p.id)),
  }));
}

/** Everything the form needs for one brand. */
export async function poFormData(ctx: AccessContext, brandId: string) {
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const db = scopedDb(ctx);
  const { gridSettings } = await import("@/server/modules/documents/lookups");
  const [brand, owners, vendors, contacts, warehouses, settings, grid] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, code: true, name: true, legalEntity: true, address: true } }),
    brandUsers(ctx, brandId),
    db.vendor.findMany({ where: { brandId, active: true }, select: { id: true, name: true, currency: true, email: true, address: true }, orderBy: { name: "asc" } }),
    db.vendorContact.findMany({ where: { brandId }, select: { id: true, vendorId: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { brandId, active: true }, select: { id: true, code: true, name: true, address: true }, orderBy: { name: "asc" } }),
    poSettings(ctx, brandId),
    gridSettings(ctx, brandId),
  ]);
  const { getSetting } = await import("@/server/modules/setup/service");
  const rates = (((await getSetting("currencies")) as { rates?: Record<string, number> }).rates ?? {}) as Record<string, number>;
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name, legalEntity: brand.legalEntity, address: brand.address },
    owners,
    vendors,
    contacts,
    warehouses,
    settings,
    grid,
    rates: { NGN: 1, ...rates } as Record<string, number>,
    canSeeCost: canSeeCost(ctx),
    canEditRate: canEditRate(ctx),
    canCreateVendor: hasPermission(ctx, "inventory", "create"),
  };
}
export type PoFormData = Awaited<ReturnType<typeof poFormData>>;

/** Creates (id = null) or changes a purchase order. Changes only while it is Created (DRAFT). */
export async function savePurchaseOrder(ctx: AccessContext, id: string | null, input: unknown) {
  const db = scopedDb(ctx);
  const before = id ? await db.inventoryDocument.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
  if (id && (!before || before.type !== "PO")) throw new NotFoundError();
  const d = poSchema.parse(before ? { ...(input as object), brandId: before.brandId } : input);
  assertBrand(ctx, id ? "edit" : "create", d.brandId);
  if (before && before.status !== "DRAFT") throw new BadRequestError("Lines and amounts are locked once the purchase order is approved – a Brand Manager can reopen it");
  const settings = await poSettings(ctx, d.brandId);

  // references: all of the PO's brand (the database checks vendor, contact and warehouse again)
  const vendor = await db.vendor.findUnique({ where: { id: d.vendorId }, select: { brandId: true, active: true } });
  if (vendor?.brandId !== d.brandId) throw new BadRequestError("The vendor does not belong to this brand");
  if (d.vendorContactId) {
    const c = await db.vendorContact.findUnique({ where: { id: d.vendorContactId }, select: { vendorId: true } });
    if (c?.vendorId !== d.vendorId) throw new BadRequestError("The contact does not belong to the vendor");
  }
  if (d.warehouseId) {
    const w = await db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { brandId: true } });
    if (w?.brandId !== d.brandId) throw new BadRequestError("The warehouse does not belong to this brand");
  }
  const ownerId = d.ownerId ?? before?.ownerId ?? ctx.userId;
  if (ownerId && !(await brandUsers(ctx, d.brandId)).some((u) => u.id === ownerId)) throw new BadRequestError("The owner has no access to this brand");
  const poDate = d.poDate ?? before?.docDate ?? new Date();
  if (d.dueDate && day(d.dueDate) < day(poDate)) throw new BadRequestError("The due date cannot be before the PO date");
  if (d.carrier && !settings.carriers.includes(d.carrier)) throw new BadRequestError("Choose a carrier from the list");

  // currency: NGN = 1; others from Setup → Currencies unless the user may type the rate
  let rate = 1;
  if (d.currency !== "NGN") {
    const ref = await referenceRate(d.currency);
    rate = canEditRate(ctx) && d.exchangeRate ? d.exchangeRate : (ref ?? 0);
    if (!(rate > 0)) throw new BadRequestError(`There is no exchange rate for ${d.currency} – set it in Setup → Currencies`);
  }
  if (!canSeeCost(ctx) && d.currency !== "NGN") throw new ForbiddenError("Only users with inventory finance access can order in another currency");

  // lines: at least one with a product name and a quantity; brand's products only; prices only with cost access
  const lines = d.lines.filter((l) => l.description.trim() || l.productId);
  if (!lines.length) throw new BadRequestError("Add at least one purchase item");
  const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const products = new Map((await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, brandId: true, costPrice: true, category: true } })).map((p) => [p.id, p]));
  for (const [i, l] of lines.entries()) {
    if (l.productId && products.get(l.productId)?.brandId !== d.brandId) throw new BadRequestError(`Line ${i + 1}: the item does not belong to this brand`);
    if (l.discountType === "AMOUNT" && (l.discountValue ?? 0) > l.qty * l.unitPrice + 0.005) throw new BadRequestError(`Line ${i + 1}: the discount is larger than the amount`);
  }
  const { rulesOf } = await import("@/server/modules/documents/service");
  const rules = await rulesOf(ctx, d.brandId);
  if (d.adjustment !== 0 && rules.adjustmentManagersOnly && !ctx.isAdmin && !(await import("@/server/access/brand-tag")).managedBrands(ctx).includes(d.brandId)) throw new ForbiddenError("Only managers may enter an adjustment");
  const blind = !canSeeCost(ctx);
  const priced = lines.map((l) => ({ ...l, unitPrice: blind ? (l.productId ? num(products.get(l.productId)?.costPrice) : 0) : l.unitPrice, discountType: l.discountType ?? "PERCENT", discountValue: blind ? 0 : (l.discountValue ?? 0), taxes: (l.taxes ?? []) as TaxRate[] }));
  const r = calcDocument(
    priced.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxes: l.taxes })),
    { discountType: d.headerDiscountType, discountValue: blind ? 0 : d.headerDiscountValue, taxes: rules.taxMode === "DOCUMENT" ? (d.documentTaxes.length ? d.documentTaxes : rules.taxes.slice(0, 1)) : [], adjustment: blind ? 0 : d.adjustment, taxMode: rules.taxMode, rounding: rules.roundingMode },
  );
  const excise = blind ? 0 : d.exciseDuty;
  const total = Math.round((r.grandTotal + (settings.addExciseToTotal ? excise : 0)) * 100) / 100;

  // a typed number: only when the brand allows it, unique
  let number = "";
  if (!id && d.number) {
    if (!settings.allowManualNumber) throw new BadRequestError("PO numbers are generated – the brand does not allow typed numbers");
    if (await db.inventoryDocument.findFirst({ where: { number: d.number }, select: { id: true } })) throw new BadRequestError(`PO number ${d.number} is already used`);
    number = d.number;
  }

  const header = {
    ownerId: ownerId || null,
    subject: d.subject,
    requisitionNumber: d.requisitionNumber ?? null,
    vendorId: d.vendorId,
    vendorContactId: d.vendorContactId ?? null,
    trackingNumber: d.trackingNumber ?? null,
    reference: d.trackingNumber ?? null,
    carrier: d.carrier ?? null,
    exciseDuty: excise,
    salesCommission: blind ? 0 : d.salesCommission,
    currency: d.currency,
    exchangeRate: rate,
    docDate: poDate,
    expectedDate: d.dueDate ?? null,
    billTo: d.billTo as Prisma.InputJsonValue,
    shipTo: d.shipTo as Prisma.InputJsonValue,
    warehouseId: d.warehouseId ?? null,
    terms: d.terms ?? null,
    description: d.description ?? null,
    notes: d.description ?? null,
    formViewId: d.formViewId && settings.formViews.some((v) => v.id === d.formViewId) ? d.formViewId : null,
    headerDiscountType: d.headerDiscountType,
    headerDiscountValue: blind ? 0 : d.headerDiscountValue,
    documentTaxes: r.documentTaxes.map(({ name, rate: t }) => ({ name, rate: t })) as Prisma.InputJsonValue,
    adjustment: r.adjustment,
    subTotal: r.subTotal,
    discountTotal: r.discountTotal,
    taxTotal: r.taxTotal,
    total,
  };
  const rows = priced.map((l, i) => {
    const c = r.lines[i]!;
    return {
      position: i + 1,
      productId: l.productId,
      description: l.description,
      details: l.details,
      itemCode: l.itemCode,
      uom: l.uom,
      qty: l.qty,
      unitCost: l.unitPrice,
      amount: c.amount,
      discountType: l.discountType,
      discountValue: l.discountValue,
      discountAmount: c.discountAmount,
      taxes: c.taxes as unknown as Prisma.InputJsonValue,
      taxAmount: c.taxAmount,
      total: c.total,
      // the net amount: what the goods cost before tax (receiving values stock at net ÷ quantity)
      lineTotal: c.net,
      isStockItem: l.isStockItem || (l.productId ? products.get(l.productId)?.category === "VEHICLE" : false),
      expectedVins: (l.expectedVins ?? []) as Prisma.InputJsonValue,
    };
  });

  if (!before) {
    const doc = await db.inventoryDocument.create({ data: { brandId: d.brandId, type: "PO", status: "DRAFT", number, createdById: ctx.userId || null, ...header } });
    await db.inventoryDocumentLine.createMany({ data: rows.map((l) => ({ ...l, documentId: doc.id })) });
    await audit({ ctx, action: "CREATE", entity: "InventoryDocument", entityId: doc.id, brandId: d.brandId, after: { type: "PO", number: doc.number, subject: d.subject, total, lines: rows.length } });
    return { id: doc.id, number: doc.number };
  }
  await db.inventoryDocumentLine.deleteMany({ where: { documentId: before.id } });
  await db.inventoryDocumentLine.createMany({ data: rows.map((l) => ({ ...l, documentId: before.id })) });
  await db.inventoryDocument.update({ where: { id: before.id }, data: { ...header, updatedById: ctx.userId || null } });
  const changed = (["subject", "vendorId", "currency", "carrier", "trackingNumber", "requisitionNumber"] as const).filter((k) => String(before[k] ?? "") !== String(header[k] ?? ""));
  await audit({
    ctx,
    action: "UPDATE",
    entity: "InventoryDocument",
    entityId: before.id,
    brandId: before.brandId,
    before: { total: num(before.total), lines: before.lines.length, ...Object.fromEntries(changed.map((k) => [k, before[k]])) },
    after: { total, lines: rows.length, ...Object.fromEntries(changed.map((k) => [k, header[k]])) },
  });
  return { id: before.id, number: before.number };
}

/** A new vendor from the PO form ("+ New vendor"). */
export async function quickVendor(ctx: AccessContext, brandId: string, input: { name: string; email?: string; contactName?: string }) {
  const { saveVendor } = await import("./service");
  const res = await saveVendor(ctx, null, { brandId, type: "OEM", name: input.name, email: input.email || undefined, contactName: input.contactName || undefined, currency: "NGN", active: true });
  if (input.contactName?.trim()) await scopedDb(ctx).vendorContact.create({ data: { brandId, vendorId: res.id, name: input.contactName.trim(), email: input.email?.trim() || null } });
  return res;
}

/** Setup → Purchase orders: carriers, default terms, excise, typed numbers, receiving warehouse, approval limit. */
export const poSettingsSchema = z.object({
  carriers: z.preprocess((v) => (typeof v === "string" ? v.split(/\r?\n/) : v), z.array(z.string().trim().min(1).max(60)).min(1, "Keep at least one carrier").max(30)),
  poTerms: text(5000),
  addExciseToTotal: z.boolean(),
  allowManualPoNumber: z.boolean(),
  receivingWarehouseId: z.preprocess(empty, z.string().max(40).optional()),
  poApprovalLimit: z.coerce.number().min(0).max(1e13),
});
export async function savePoSettings(ctx: AccessContext, brandId: string, input: unknown) {
  if (!canDesignForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins manage purchase order settings");
  const d = poSettingsSchema.parse(input);
  const db = scopedDb(ctx);
  if (d.receivingWarehouseId) {
    const w = await db.warehouse.findUnique({ where: { id: d.receivingWarehouseId }, select: { brandId: true } });
    if (w?.brandId !== brandId) throw new BadRequestError("The warehouse does not belong to this brand");
  }
  const before = await posting.brandSettings(brandId);
  const after = await db.inventorySettings.update({ where: { brandId }, data: { carriers: [...new Set(d.carriers)], poTerms: d.poTerms ?? null, addExciseToTotal: d.addExciseToTotal, allowManualPoNumber: d.allowManualPoNumber, receivingWarehouseId: d.receivingWarehouseId ?? null, poApprovalLimit: d.poApprovalLimit } });
  await audit({ ctx, action: "UPDATE", entity: "InventorySettings", entityId: brandId, brandId, before: { carriers: before.carriers, poTerms: before.poTerms, addExciseToTotal: before.addExciseToTotal, allowManualPoNumber: before.allowManualPoNumber, poApprovalLimit: num(before.poApprovalLimit) }, after: { carriers: after.carriers, poTerms: after.poTerms, addExciseToTotal: after.addExciseToTotal, allowManualPoNumber: after.allowManualPoNumber, poApprovalLimit: num(after.poApprovalLimit) } });
}

/** "Create a custom form page": a named view of the PO form that hides fields or sections. */
export async function savePoFormView(ctx: AccessContext, brandId: string, input: { id?: string | null; name: string; hidden: string[] }) {
  if (!canDesignForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins design form views");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new BadRequestError("Give the view a name (2–60 characters)");
  const hidden = input.hidden.filter((h): h is PoFormPart => h in PO_FORM_PARTS);
  const s = await poSettings(ctx, brandId);
  if (s.formViews.some((v) => v.name.toLowerCase() === name.toLowerCase() && v.id !== input.id)) throw new BadRequestError("A view with this name exists");
  const id = input.id && s.formViews.some((v) => v.id === input.id) ? input.id : `fv${Date.now().toString(36)}`;
  const views = [...s.formViews.filter((v) => v.id !== id), { id, name, hidden }];
  await scopedDb(ctx).inventorySettings.update({ where: { brandId }, data: { poFormViews: views as unknown as Prisma.InputJsonValue } });
  await audit({ ctx, action: input.id ? "UPDATE" : "CREATE", entity: "InventorySettings", entityId: brandId, brandId, after: { formView: { id, name, hidden } } });
  return { id };
}
export async function deletePoFormView(ctx: AccessContext, brandId: string, viewId: string) {
  if (!canDesignForm(ctx, brandId)) throw new ForbiddenError("Administrators and Brand Admins design form views");
  const s = await poSettings(ctx, brandId);
  await scopedDb(ctx).inventorySettings.update({ where: { brandId }, data: { poFormViews: s.formViews.filter((v) => v.id !== viewId) as unknown as Prisma.InputJsonValue } });
  await audit({ ctx, action: "DELETE", entity: "InventorySettings", entityId: brandId, brandId, before: { formView: viewId } });
}

/** A PO for the record page and the edit / clone forms (prices only with cost access). */
export async function getPurchaseOrder(ctx: AccessContext, id: string) {
  if (!hasPermission(ctx, "inventory", "read")) throw new NotFoundError();
  const db = scopedDb(ctx);
  const d = await db.inventoryDocument.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!d || d.type !== "PO") throw new NotFoundError();
  const cost = canSeeCost(ctx);
  const [vendor, contact, owner, warehouse, children] = await Promise.all([
    d.vendorId ? db.vendor.findUnique({ where: { id: d.vendorId }, select: { id: true, name: true, email: true } }) : null,
    d.vendorContactId ? db.vendorContact.findUnique({ where: { id: d.vendorContactId }, select: { id: true, name: true, email: true } }) : null,
    d.ownerId ? db.user.findUnique({ where: { id: d.ownerId }, select: { id: true, name: true } }) : null,
    d.warehouseId ? db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true, name: true } }) : null,
    db.inventoryDocument.findMany({ where: { parentId: id }, select: { id: true, type: true, number: true, status: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const addr = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, string>) : {});
  return {
    id: d.id,
    brandId: d.brandId,
    number: d.number,
    status: d.status,
    statusLabel: PO_STATUS_LABELS[d.status] ?? d.status,
    subject: d.subject ?? d.reference ?? d.number,
    requisitionNumber: d.requisitionNumber,
    vendor,
    contact,
    owner,
    warehouse,
    trackingNumber: d.trackingNumber,
    carrier: d.carrier,
    poDate: day(d.docDate),
    dueDate: d.expectedDate ? day(d.expectedDate) : null,
    currency: d.currency,
    exchangeRate: num(d.exchangeRate),
    exciseDuty: cost ? num(d.exciseDuty) : null,
    salesCommission: cost ? num(d.salesCommission) : null,
    billTo: addr(d.billTo),
    shipTo: addr(d.shipTo),
    terms: d.terms,
    description: d.description ?? d.notes,
    formViewId: d.formViewId,
    headerDiscountType: (d.headerDiscountType === "AMOUNT" ? "AMOUNT" : "PERCENT") as "PERCENT" | "AMOUNT",
    headerDiscountValue: cost ? num(d.headerDiscountValue) : 0,
    documentTaxes: (Array.isArray(d.documentTaxes) ? d.documentTaxes : []) as unknown as TaxRate[],
    adjustment: cost ? num(d.adjustment) : 0,
    total: cost ? num(d.total) : null,
    data: (d.data && typeof d.data === "object" ? d.data : {}) as Record<string, unknown>,
    children,
    lines: d.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      description: l.description,
      details: l.details,
      itemCode: l.itemCode,
      uom: l.uom,
      qty: num(l.qty),
      unitPrice: cost ? num(l.unitCost) : 0,
      discountType: (l.discountType === "AMOUNT" ? "AMOUNT" : "PERCENT") as "PERCENT" | "AMOUNT",
      discountValue: cost ? num(l.discountValue) : 0,
      taxes: (Array.isArray(l.taxes) ? l.taxes : []) as unknown as TaxRate[],
      vins: (Array.isArray(l.expectedVins) ? l.expectedVins : []) as string[],
      isStockItem: l.isStockItem,
      needsApproval: false,
    })),
  };
}
export type PurchaseOrderView = Awaited<ReturnType<typeof getPurchaseOrder>>;
