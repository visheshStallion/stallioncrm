import "server-only";
import { parseCsvObjects, toCsv } from "@/lib/csv";
import { assertCanManageBrandData, assertSameBrand } from "@/server/access/brand-tag";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { getDeal } from "@/server/modules/deals/queries";
import { overlappingDefaults } from "./pricing";
import { getPriceBook } from "./queries";
import { entrySchema, priceBookSchema, productSchema, stockSchema, type PriceBookInput, type ProductInput } from "./schema";

const displayName = (model: string, variant: string | null) => [model, variant].filter(Boolean).join(" ");

// ───────────────────────────── products ─────────────────────────────

export async function createProduct(ctx: AccessContext, brandId: string, input: ProductInput) {
  assertCanManageBrandData(ctx, "products", "create", brandId);
  const data = productSchema.parse(input);
  const product = await scopedDb(ctx).product.create({ data: { ...data, brandId, name: displayName(data.model, data.variant) } });
  await audit({ ctx, action: "CREATE", entity: "Product", entityId: product.id, brandId, after: product });
  return { id: product.id };
}

/** The brand of a product never changes. */
export async function updateProduct(ctx: AccessContext, id: string, input: ProductInput) {
  const db = scopedDb(ctx);
  const before = await db.product.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  assertCanManageBrandData(ctx, "products", "edit", before.brandId);
  const data = productSchema.parse(input);
  const after = await db.product.update({ where: { id }, data: { ...data, name: displayName(data.model, data.variant) } });
  await audit({ ctx, action: "UPDATE", entity: "Product", entityId: id, brandId: before.brandId, before, after });
  return { id };
}

// ───────────────────────────── price books ─────────────────────────────

async function assertNoOverlap(ctx: AccessContext, book: { id: string; brandId: string; validFrom: Date; validTo: Date | null; active: boolean; isDefault: boolean }) {
  const others = await scopedDb(ctx).priceBook.findMany({ where: { brandId: book.brandId, isDefault: true, active: true } });
  const clash = overlappingDefaults(book, others);
  if (clash.length) {
    throw new BadRequestError(`Another default price book (${clash.map((c) => c.name).join(", ")}) is valid in the same period – end it first or change the dates`);
  }
}

export async function createPriceBook(ctx: AccessContext, brandId: string, input: PriceBookInput) {
  assertCanManageBrandData(ctx, "priceBooks", "create", brandId);
  const data = priceBookSchema.parse(input);
  await assertNoOverlap(ctx, { id: "", brandId, ...data });
  const book = await scopedDb(ctx).priceBook.create({ data: { ...data, brandId } });
  await audit({ ctx, action: "CREATE", entity: "PriceBook", entityId: book.id, brandId, after: book });
  return { id: book.id };
}

export async function updatePriceBook(ctx: AccessContext, id: string, input: PriceBookInput) {
  const db = scopedDb(ctx);
  const before = await db.priceBook.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  assertCanManageBrandData(ctx, "priceBooks", "edit", before.brandId);
  const data = priceBookSchema.parse(input);
  await assertNoOverlap(ctx, { id, brandId: before.brandId, ...data });
  const after = await db.priceBook.update({ where: { id }, data });
  await audit({ ctx, action: "UPDATE", entity: "PriceBook", entityId: id, brandId: before.brandId, before, after });
  return { id };
}

async function loadBookForEdit(ctx: AccessContext, priceBookId: string) {
  const book = await scopedDb(ctx).priceBook.findUnique({ where: { id: priceBookId } });
  if (!book) throw new NotFoundError();
  assertCanManageBrandData(ctx, "priceBooks", "edit", book.brandId);
  return book;
}

/** Adds or updates one entry. The product must belong to the price book's brand (also enforced by a DB trigger). */
export async function upsertEntry(ctx: AccessContext, priceBookId: string, input: unknown) {
  const book = await loadBookForEdit(ctx, priceBookId);
  const data = entrySchema.parse(input);
  const db = scopedDb(ctx);
  const product = await db.product.findUnique({ where: { id: data.productId }, select: { brandId: true } });
  assertSameBrand(book.brandId, product?.brandId);
  const entry = await db.priceBookEntry.upsert({
    where: { priceBookId_productId: { priceBookId, productId: data.productId } },
    update: { price: data.price, maxDiscountPct: data.maxDiscountPct, notes: data.notes },
    create: { priceBookId, ...data },
  });
  await audit({ ctx, action: "UPDATE", entity: "PriceBookEntry", entityId: entry.id, brandId: book.brandId, after: entry });
  return { id: entry.id };
}

export async function removeEntry(ctx: AccessContext, entryId: string) {
  const db = scopedDb(ctx);
  const entry = await db.priceBookEntry.findUnique({ where: { id: entryId }, include: { priceBook: true } });
  if (!entry) throw new NotFoundError();
  assertCanManageBrandData(ctx, "priceBooks", "edit", entry.priceBook.brandId);
  await db.priceBookEntry.delete({ where: { id: entryId } });
  await audit({ ctx, action: "DELETE", entity: "PriceBookEntry", entityId: entryId, brandId: entry.priceBook.brandId, before: { ...entry, priceBook: undefined } });
}

// ── CSV import / export (columns: code, price, max_discount_pct, notes) ──

export interface PriceImportRow {
  line: number;
  code: string;
  productId: string | null;
  productName: string | null;
  price: number | null;
  maxDiscountPct: number | null;
  notes: string | null;
  action: "create" | "update" | "none";
  error: string | null;
}

/** Pure planning step (unit-tested): validates codes against the brand's products and the numbers. */
export function planPriceImport(
  csvText: string,
  products: Array<{ id: string; code: string; name: string }>,
  existing: Array<{ productId: string; price: number }>,
): { rows: PriceImportRow[]; ok: number; errors: number } {
  const { headers, rows } = parseCsvObjects(csvText);
  for (const col of ["code", "price"]) if (!headers.includes(col)) throw new BadRequestError(`Missing column: ${col}`);
  if (rows.length > 5000) throw new BadRequestError("At most 5000 rows per import");
  const byCode = new Map(products.map((p) => [p.code.toUpperCase(), p]));
  const seen = new Set<string>();
  const planned = rows.map((r, i): PriceImportRow => {
    const code = (r.code ?? "").toUpperCase();
    const product = byCode.get(code) ?? null;
    const rawPrice = (r.price ?? "").replace(/,/g, "");
    const price = rawPrice === "" ? NaN : Number(rawPrice);
    const disc = r.max_discount_pct === undefined || r.max_discount_pct === "" ? null : Number(r.max_discount_pct);
    let error: string | null = null;
    if (!code) error = "Code is required";
    else if (!product) error = "Unknown product code for this brand";
    else if (seen.has(code)) error = "Duplicate code in file";
    else if (!Number.isFinite(price) || price < 0) error = "Invalid price";
    else if (disc !== null && (!Number.isFinite(disc) || disc < 0 || disc > 100)) error = "Invalid max discount %";
    seen.add(code);
    const current = product ? existing.find((e) => e.productId === product.id) : undefined;
    return {
      line: i + 2,
      code,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      price: Number.isFinite(price) ? price : null,
      maxDiscountPct: disc,
      notes: r.notes || null,
      action: error ? "none" : current ? "update" : "create",
      error,
    };
  });
  return { rows: planned, ok: planned.filter((r) => !r.error).length, errors: planned.filter((r) => r.error).length };
}

async function planFor(ctx: AccessContext, priceBookId: string, csvText: string) {
  const book = await loadBookForEdit(ctx, priceBookId);
  const db = scopedDb(ctx);
  const [products, entries] = await Promise.all([
    db.product.findMany({ where: { brandId: book.brandId }, select: { id: true, code: true, name: true } }),
    db.priceBookEntry.findMany({ where: { priceBookId }, select: { productId: true, price: true } }),
  ]);
  return { book, plan: planPriceImport(csvText, products, entries.map((e) => ({ productId: e.productId, price: Number(e.price.toString()) }))) };
}

export async function dryRunPriceImport(ctx: AccessContext, priceBookId: string, csvText: string) {
  return (await planFor(ctx, priceBookId, csvText)).plan;
}

/** Applies the valid rows; rows with errors are skipped. */
export async function commitPriceImport(ctx: AccessContext, priceBookId: string, csvText: string) {
  const { book, plan } = await planFor(ctx, priceBookId, csvText);
  const db = scopedDb(ctx);
  let applied = 0;
  for (const r of plan.rows) {
    if (r.error || !r.productId || r.price === null) continue;
    await db.priceBookEntry.upsert({
      where: { priceBookId_productId: { priceBookId, productId: r.productId } },
      update: { price: r.price, maxDiscountPct: r.maxDiscountPct, notes: r.notes },
      create: { priceBookId, productId: r.productId, price: r.price, maxDiscountPct: r.maxDiscountPct, notes: r.notes },
    });
    applied++;
  }
  await audit({ ctx, action: "IMPORT", entity: "PriceBook", entityId: priceBookId, brandId: book.brandId, after: { applied, skipped: plan.errors } });
  return { applied, skipped: plan.errors };
}

export async function exportPriceBook(ctx: AccessContext, priceBookId: string) {
  assertCan(ctx, "priceBooks", "export");
  const book = await getPriceBook(ctx, priceBookId);
  await audit({ ctx, action: "EXPORT", entity: "PriceBook", entityId: priceBookId, brandId: book.brandId, after: { rows: book.entries.length } });
  return { name: book.name, csv: toCsv(["code", "product", "price", "max_discount_pct", "notes"], book.entries.map((e) => [e.code, e.productName, e.price, e.maxDiscountPct, e.notes])) };
}

// ───────────────────────────── stock references & VIN reservation ─────────────────────────────

export async function addStock(ctx: AccessContext, input: unknown) {
  const data = stockSchema.parse(input);
  const db = scopedDb(ctx);
  const product = await db.product.findUnique({ where: { id: data.productId }, select: { brandId: true } });
  if (!product) throw new NotFoundError();
  assertCanManageBrandData(ctx, "products", "edit", product.brandId);
  if (await db.vehicleStockRef.findFirst({ where: { brandId: product.brandId, vin: data.vin }, select: { id: true } })) {
    throw new BadRequestError("This VIN already exists for the brand");
  }
  const stock = await db.vehicleStockRef.create({ data: { ...data, brandId: product.brandId } });
  await audit({ ctx, action: "CREATE", entity: "VehicleStockRef", entityId: stock.id, brandId: product.brandId, after: stock });
  return { id: stock.id };
}

/**
 * Reserves a vehicle for a deal: same brand, available (in stock / in transit), and the user can edit the deal.
 * The VIN and colour are copied to the deal.
 */
export async function reserveVin(ctx: AccessContext, dealId: string, stockId: string) {
  const deal = await getDeal(ctx, dealId);
  assertCan(ctx, "deals", "edit", deal);
  if (deal.stageType !== "OPEN") throw new ForbiddenError("Only open deals can reserve a vehicle");
  const db = scopedDb(ctx);
  const stock = await db.vehicleStockRef.findUnique({ where: { id: stockId } });
  assertSameBrand(deal.brandId, stock?.brandId, "The vehicle");
  if (stock!.status !== "IN_STOCK" && stock!.status !== "IN_TRANSIT") throw new BadRequestError("This vehicle is not available");
  // Atomic claim: only succeeds while the vehicle is still available.
  const claimed = await db.vehicleStockRef.updateMany({ where: { id: stockId, status: { in: ["IN_STOCK", "IN_TRANSIT"] } }, data: { status: "RESERVED", dealId } });
  if (claimed.count === 0) throw new BadRequestError("This vehicle was just reserved by someone else");
  await releaseVins(ctx, dealId, stockId);
  await db.deal.update({ where: { id: dealId }, data: { vinChassisNo: stock!.vin, colour: stock!.colour ?? deal.colour }, select: { id: true } });
  await audit({ ctx, action: "UPDATE", entity: "VehicleStockRef", entityId: stockId, brandId: deal.brandId, before: { status: stock!.status }, after: { status: "RESERVED", dealId } });
}

/** Releases the deal's reservations (all, or all except `keepId`) back to stock. */
export async function releaseVins(ctx: AccessContext, dealId: string, keepId?: string) {
  const res = await scopedDb(ctx).vehicleStockRef.updateMany({
    where: { dealId, status: "RESERVED", ...(keepId ? { id: { not: keepId } } : {}) },
    data: { status: "IN_STOCK", dealId: null },
  });
  return res.count;
}

export async function releaseVin(ctx: AccessContext, dealId: string) {
  const deal = await getDeal(ctx, dealId);
  assertCan(ctx, "deals", "edit", deal);
  const count = await releaseVins(ctx, dealId);
  if (count) await scopedDb(ctx).deal.update({ where: { id: dealId }, data: { vinChassisNo: null }, select: { id: true } });
  return count;
}

/** Deal stage hook: Closed Lost releases the reservation, Closed Won marks the vehicle sold. */
export async function onDealStageChanged(ctx: AccessContext, dealId: string, toType: "OPEN" | "WON" | "LOST") {
  const db = scopedDb(ctx);
  if (toType === "LOST") {
    const released = await db.vehicleStockRef.updateMany({ where: { dealId, status: "RESERVED" }, data: { status: "IN_STOCK", dealId: null } });
    // The vehicle is free again: the lost deal must not keep its VIN (VINs are unique per brand).
    if (released.count) await db.deal.update({ where: { id: dealId }, data: { vinChassisNo: null }, select: { id: true } });
  }
  if (toType === "WON") await db.vehicleStockRef.updateMany({ where: { dealId, status: "RESERVED" }, data: { status: "SOLD" } });
}
