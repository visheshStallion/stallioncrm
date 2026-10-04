import "server-only";
import type { Prisma } from "@prisma/client";
import { assertSameBrand, brandTagWhere } from "@/server/access/brand-tag";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import type { FieldDef } from "@/server/list/filters";
import { defaultBookFor, resolve, validOn, type ResolvedPrice } from "./pricing";
import { CATEGORIES, CATEGORY_LABELS } from "./schema";

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const dateOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

type ProductRecord = Prisma.ProductGetPayload<object>;
export interface ProductRow {
  id: string;
  brandId: string;
  code: string;
  name: string;
  category: string;
  model: string | null;
  variant: string | null;
  modelYear: number | null;
  bodyType: string | null;
  fuel: string | null;
  transmission: string | null;
  engineCc: number | null;
  colours: string[];
  listPrice: number | null;
  taxCode: string;
  taxRatePct: number;
  imageUrls: string[];
  specSheetUrl: string | null;
  description: string | null;
  active: boolean;
}

function toProductRow(p: ProductRecord): ProductRow {
  return {
    id: p.id,
    brandId: p.brandId,
    code: p.code,
    name: p.name,
    category: p.category,
    model: p.model,
    variant: p.variant,
    modelYear: p.modelYear,
    bodyType: p.bodyType,
    fuel: p.fuel,
    transmission: p.transmission,
    engineCc: p.engineCc,
    colours: p.colours,
    listPrice: num(p.listPrice),
    taxCode: p.taxCode,
    taxRatePct: Number(p.taxRatePct.toString()),
    imageUrls: p.imageUrls,
    specSheetUrl: p.specSheetUrl,
    description: p.description,
    active: p.active,
  };
}

/**
 * Catalogue list. Besides scopedDb / RLS, the brand filter is applied here explicitly: a `brandId` outside the
 * user's brands yields nothing (it can only narrow).
 */
export async function listProducts(
  ctx: AccessContext,
  opts: { brandId?: string | null; q?: string; where?: Prisma.ProductWhereInput; take?: number; skip?: number; activeOnly?: boolean } = {},
): Promise<{ rows: ProductRow[]; total: number }> {
  assertCan(ctx, "products", "read");
  const q = opts.q?.trim();
  const where: Prisma.ProductWhereInput = {
    AND: [
      brandTagWhere(ctx),
      opts.brandId ? { brandId: opts.brandId } : {},
      opts.activeOnly ? { active: true } : {},
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }] } : {},
      opts.where ?? {},
    ],
  };
  const db = scopedDb(ctx);
  const [rows, total] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ model: "asc" }, { variant: "asc" }, { code: "asc" }], take: Math.min(opts.take ?? 50, 5000), skip: opts.skip ?? 0 }),
    db.product.count({ where }),
  ]);
  return { rows: rows.map(toProductRow), total };
}

/** 404 for missing products and products of brands the user does not work in. */
export async function getProduct(ctx: AccessContext, id: string): Promise<ProductRow> {
  assertCan(ctx, "products", "read");
  const p = await scopedDb(ctx).product.findUnique({ where: { id } });
  if (!p) throw new NotFoundError();
  return toProductRow(p);
}

export function productFilterFields(brands: Array<{ id: string; code: string }>): FieldDef[] {
  return [
    { key: "model", label: "Model", type: "text" },
    { key: "variant", label: "Variant", type: "text" },
    { key: "code", label: "Code / SKU", type: "text", nullable: false },
    { key: "category", label: "Category", type: "enum", nullable: false, options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
    { key: "active", label: "Active", type: "boolean", nullable: false },
    { key: "bodyType", label: "Body type", type: "text" },
    { key: "fuel", label: "Fuel", type: "text" },
    { key: "modelYear", label: "Model year", type: "number" },
    { key: "listPrice", label: "List price", type: "number" },
    { key: "brandId", label: "Brand", type: "enum", nullable: false, options: brands.map((b) => ({ value: b.id, label: b.code })) },
  ];
}

// ───────────────────────────── price books ─────────────────────────────

export interface PriceBookRow {
  id: string;
  brandId: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  isDefault: boolean;
  entryCount: number;
  validToday: boolean;
}

export async function listPriceBooks(ctx: AccessContext, brandId?: string | null): Promise<PriceBookRow[]> {
  assertCan(ctx, "priceBooks", "read");
  const rows = await scopedDb(ctx).priceBook.findMany({
    where: { AND: [brandTagWhere(ctx), brandId ? { brandId } : {}] },
    include: { _count: { select: { entries: true } } },
    orderBy: [{ brand: { code: "asc" } }, { validFrom: "desc" }],
  });
  const today = new Date();
  return rows.map((b) => ({
    id: b.id,
    brandId: b.brandId,
    name: b.name,
    validFrom: dateOnly(b.validFrom)!,
    validTo: dateOnly(b.validTo),
    active: b.active,
    isDefault: b.isDefault,
    entryCount: b._count.entries,
    validToday: validOn(b, today),
  }));
}

export async function getPriceBook(ctx: AccessContext, id: string) {
  assertCan(ctx, "priceBooks", "read");
  const b = await scopedDb(ctx).priceBook.findUnique({
    where: { id },
    include: { entries: { include: { product: { select: { id: true, code: true, name: true, listPrice: true, active: true } } }, orderBy: { product: { code: "asc" } } } },
  });
  if (!b) throw new NotFoundError();
  return {
    id: b.id,
    brandId: b.brandId,
    name: b.name,
    validFrom: dateOnly(b.validFrom)!,
    validTo: dateOnly(b.validTo),
    active: b.active,
    isDefault: b.isDefault,
    validToday: validOn(b, new Date()),
    entries: b.entries.map((e) => ({
      id: e.id,
      productId: e.productId,
      code: e.product.code,
      productName: e.product.name,
      listPrice: num(e.product.listPrice),
      price: Number(e.price.toString()),
      maxDiscountPct: num(e.maxDiscountPct),
      notes: e.notes,
    })),
  };
}

/**
 * Price resolution: the entry in `priceBookId` (which must be a valid book of the product's brand), otherwise the
 * brand's default active price book for `date`, otherwise the product's list price.
 */
export async function getPrice(ctx: AccessContext, productId: string, date = new Date(), priceBookId?: string | null): Promise<ResolvedPrice> {
  const db = scopedDb(ctx);
  const product = await db.product.findUnique({ where: { id: productId }, select: { brandId: true, listPrice: true, taxRatePct: true } });
  if (!product) throw new NotFoundError();
  const books = await db.priceBook.findMany({ where: { brandId: product.brandId, active: true } });
  let book = null;
  if (priceBookId) {
    const chosen = await db.priceBook.findUnique({ where: { id: priceBookId } });
    assertSameBrand(product.brandId, chosen?.brandId, "The price book");
    book = chosen && validOn(chosen, date) ? chosen : null;
  }
  book ??= defaultBookFor(books, product.brandId, date);
  const entry = book ? await db.priceBookEntry.findUnique({ where: { priceBookId_productId: { priceBookId: book.id, productId } } }) : null;
  return resolve(
    { listPrice: num(product.listPrice), taxRatePct: Number(product.taxRatePct.toString()) },
    entry ? { price: Number(entry.price.toString()), maxDiscountPct: num(entry.maxDiscountPct), priceBookId: entry.priceBookId } : null,
  );
}

// ───────────────────────────── stock references ─────────────────────────────

export interface StockRow {
  id: string;
  brandId: string;
  productId: string;
  productName: string;
  vin: string;
  colour: string | null;
  location: string | null;
  status: string;
  dealId: string | null;
}

export async function listStock(ctx: AccessContext, where: Prisma.VehicleUnitWhereInput = {}): Promise<StockRow[]> {
  assertCan(ctx, "products", "read");
  const rows = await scopedDb(ctx).vehicleUnit.findMany({
    where: { AND: [brandTagWhere(ctx), where] },
    include: { product: { select: { name: true } }, warehouse: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { vin: "asc" }],
    take: 500,
  });
  return rows.map((s) => ({ id: s.id, brandId: s.brandId, productId: s.productId, productName: s.product.name, vin: s.vin, colour: s.colour, location: s.warehouse?.name ?? null, status: s.status, dealId: s.dealId }));
}
