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

/** The brand's active products with their price-book price on a date (the document form's product picker). */
export async function brandProducts(ctx: AccessContext, brandId: string) {
  if (!ctx.brandIds.includes(brandId)) throw new NotFoundError();
  if (!hasPermission(ctx, "products", "read")) return [];
  const { getPrice, listProducts } = await import("@/server/modules/catalogue/queries");
  const list = await listProducts(ctx, { brandId, activeOnly: true, take: 500 });
  return Promise.all(list.rows.map(async (p) => {
    const price = await getPrice(ctx, p.id, new Date());
    return { id: p.id, name: p.name, price: price.price, taxRatePct: price.taxRatePct, maxDiscountPct: price.maxDiscountPct, vehicle: p.category === "VEHICLE" };
  }));
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
