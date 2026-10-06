/**
 * Lookups of the standalone document form (prompt 23): customers to pick for the bill-to, link targets of the same
 * brand, the brand's products with their price-book price. Everything is read with the user's access – a hidden
 * record is never offered, customer fields are masked as on screen.
 */
import "server-only";
import { canManageBrandData } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { fieldMaskView } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { normalizePhone } from "@/lib/phone";

export interface CustomerHit {
  kind: "account" | "contact";
  id: string;
  accountId: string | null;
  contactId: string | null;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

/** Accounts and contacts matching a name or phone (as the user may see them). */
export async function searchCustomers(ctx: AccessContext, raw: string): Promise<CustomerHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const db = scopedDb(ctx);
  const phone = normalizePhone(q);
  const out: CustomerHit[] = [];
  if (hasPermission(ctx, "accounts", "read")) {
    const accounts = await db.account.findMany({ where: { deletedAt: null, OR: [{ name: { contains: q, mode: "insensitive" } }, ...(phone ? [{ phone }] : [])] }, select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true }, take: 8, orderBy: { name: "asc" } });
    for (const a of accounts) {
      const m = fieldMaskView(ctx, "accounts", a) as typeof a;
      out.push({ kind: "account", id: a.id, accountId: a.id, contactId: null, name: a.name, company: null, phone: m.phone ?? null, email: m.email ?? null, address: m.address ?? null, city: m.city ?? null, state: m.state ?? null });
    }
  }
  if (hasPermission(ctx, "contacts", "read")) {
    const contacts = await db.contact.findMany({ where: { deletedAt: null, OR: [{ lastName: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, ...(phone ? [{ mobile: phone }] : [])] }, select: { id: true, firstName: true, lastName: true, mobile: true, email: true, accountId: true, account: { select: { name: true } } }, take: 8, orderBy: { lastName: "asc" } });
    for (const c of contacts) {
      const m = fieldMaskView(ctx, "contacts", c) as typeof c;
      out.push({ kind: "contact", id: c.id, accountId: c.accountId, contactId: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), company: c.account?.name ?? null, phone: m.mobile ?? null, email: m.email ?? null, address: null, city: null, state: null });
    }
  }
  return out;
}

/** Non-blocking duplicate hint: a customer the user can see with this phone. */
export async function customerByPhone(ctx: AccessContext, raw: string): Promise<CustomerHit | null> {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  return (await searchCustomers(ctx, phone)).find((h) => h.phone === phone) ?? null;
}

/** Link targets of the same brand: deals, quotes, sales orders. */
export async function linkTargets(ctx: AccessContext, brandId: string, kind: "deal" | "quote" | "salesOrder", raw: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const q = raw.trim().slice(0, 80);
  const db = scopedDb(ctx);
  if (kind === "deal") {
    if (!hasPermission(ctx, "deals", "read")) return [];
    const rows = await db.deal.findMany({ where: { brandId, deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, regionId: true, customerName: true }, take: 15, orderBy: { updatedAt: "desc" } });
    return rows.map((d) => ({ id: d.id, label: d.customerName ? `${d.name} · ${d.customerName}` : d.name, regionId: d.regionId }));
  }
  const moduleKey = kind === "quote" ? "quotes" : "salesOrders";
  if (!hasPermission(ctx, moduleKey, "read")) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- quote / salesOrder share these columns
  const rows: Array<{ id: string; number: string; status: string; regionId: string; billTo: unknown }> = await (db as any)[kind].findMany({ where: { brandId, deletedAt: null, ...(q ? { number: { contains: q, mode: "insensitive" } } : {}) }, select: { id: true, number: true, status: true, regionId: true, billTo: true }, take: 15, orderBy: { createdAt: "desc" } });
  return rows.map((d) => ({ id: d.id, label: `${d.number} · ${(d.billTo as { name?: string } | null)?.name ?? d.status}`, regionId: d.regionId }));
}

export interface GridProduct {
  id: string;
  name: string;
  code: string;
  category: string;
  price: number | null;
  taxRatePct: number;
  maxDiscountPct: number | null;
  vehicle: boolean;
  uom: string | null;
  /** stock of the brand (only for users who may see inventory) */
  stock: { inStock: number; reserved: number; inTransit: number } | null;
}

/** The brand's active products with their price-book price on a date (the grid's product search and picker). */
export async function brandProducts(ctx: AccessContext, brandId: string): Promise<GridProduct[]> {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (!hasPermission(ctx, "products", "read")) return [];
  const { getPrice, listProducts } = await import("@/server/modules/catalogue/queries");
  const list = await listProducts(ctx, { brandId, activeOnly: true, take: 500 });
  const counts = hasPermission(ctx, "inventory", "read") ? await scopedDb(ctx).vehicleUnit.groupBy({ by: ["productId", "status"], where: { brandId, productId: { in: list.rows.map((p) => p.id) } }, _count: { _all: true } }) : null;
  const n = (productId: string, statuses: string[]) => (counts ?? []).filter((c) => c.productId === productId && statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
  return Promise.all(
    list.rows.map(async (p) => {
      const price = await getPrice(ctx, p.id, new Date());
      return {
        id: p.id,
        name: p.name,
        code: (p as { code?: string }).code ?? "",
        category: p.category,
        price: price.price,
        taxRatePct: price.taxRatePct,
        maxDiscountPct: price.maxDiscountPct,
        vehicle: p.category === "VEHICLE",
        uom: p.category === "VEHICLE" ? "unit" : null,
        stock: counts ? { inStock: n(p.id, ["AVAILABLE", "PDI_PENDING", "DEMO"]), reserved: n(p.id, ["RESERVED", "ALLOCATED"]), inTransit: n(p.id, ["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING"]) } : null,
      };
    }),
  );
}

/** Vehicles in stock of the brand: by VIN text, or the available units of one product ("Pick from stock"). */
export async function stockUnits(ctx: AccessContext, brandId: string, opts: { q?: string; productId?: string }) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (!hasPermission(ctx, "inventory", "read")) return [];
  const q = (opts.q ?? "").trim().toUpperCase();
  const rows = await scopedDb(ctx).vehicleUnit.findMany({
    where: { brandId, ...(opts.productId ? { productId: opts.productId } : {}), ...(q ? { vin: { contains: q } } : {}), status: { in: ["AVAILABLE", "PDI_PENDING", "DEMO", "ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING"] } },
    select: { id: true, vin: true, colour: true, status: true, productId: true, product: { select: { name: true } }, warehouse: { select: { name: true } } },
    take: 30,
    orderBy: { vin: "asc" },
  });
  return rows.map((u) => ({ id: u.id, vin: u.vin, productId: u.productId, productName: u.product.name, colour: u.colour, status: u.status, location: u.warehouse?.name ?? null }));
}

export const canSaveAsProduct = (ctx: AccessContext, brandId: string) => canManageBrandData(ctx, "products", "create", brandId);

/** "Save as product": a free-text line becomes a product of the brand (Brand Manager / administrator of that brand). */
export async function saveLineAsProduct(ctx: AccessContext, brandId: string, input: { name: string; price: number; vehicle: boolean }) {
  const name = input.name.trim();
  if (name.length < 2) throw new BadRequestError("Give the item a name first");
  const code = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "ITEM"}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const { createProduct } = await import("@/server/modules/catalogue/service");
  const p = await createProduct(ctx, brandId, { code, model: name.slice(0, 80), category: input.vehicle ? "VEHICLE" : "ACCESSORY", listPrice: input.price } as never);
  return { id: p.id, name: name.slice(0, 80), price: input.price };
}

/** The brand settings the grid needs: taxes, tax mode, free-text allowed, who may enter an adjustment. */
export async function gridSettings(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  const { rulesOf } = await import("./service");
  const { managedBrands } = await import("@/server/access/brand-tag");
  const r = await rulesOf(ctx, brandId);
  return { taxes: r.taxes, taxMode: r.taxMode, requireProduct: r.requireProduct, canAdjust: !r.adjustmentManagersOnly || !!ctx.isAdmin || managedBrands(ctx).includes(brandId) };
}
