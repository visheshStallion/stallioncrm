import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db/scoped";
import { getPrice, getPriceBook, getProduct, listPriceBooks, listProducts, listStock } from "@/server/modules/catalogue/queries";
import * as svc from "@/server/modules/catalogue/service";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal, moveDealStage } from "@/server/modules/deals/service";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let admin: AccessContext;
let hmnlProduct: { id: string; code: string; listPrice: unknown };
let snmnlProduct: { id: string };
let hmnlBook: { id: string };

beforeAll(async () => {
  I = await ids();
  [exec, bm, admin] = await Promise.all([ctxFor("exec.hmnl.1"), ctxFor("bm.hmnl"), ctxFor("admin")]);
  hmnlProduct = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, orderBy: { code: "asc" } });
  snmnlProduct = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
  hmnlBook = await unsafeDb.priceBook.findFirstOrThrow({ where: { brandId: I.brand("HMNL") } });
});

describe("seed catalogue", () => {
  it("3 models × 2 variants per active brand, one default price book each", async () => {
    for (const code of ["HMNL", "SNMNL", "SMGL", "THPL", "ZANL"]) {
      expect(await unsafeDb.product.count({ where: { brandId: I.brand(code), category: "VEHICLE" } })).toBe(6);
      const books = await unsafeDb.priceBook.findMany({ where: { brandId: I.brand(code), isDefault: true }, include: { _count: { select: { entries: true } } } });
      expect(books).toHaveLength(1);
      expect(books[0]!._count.entries).toBe(6);
    }
  });
});

describe("isolation: products and price books are limited to the user's brands", () => {
  it("the HMNL exec's product picker never returns SNMNL products", async () => {
    const { rows, total } = await listProducts(exec, { take: 500 });
    expect(total).toBe(26); // 6 vehicles + 20 parts and accessories
    expect(new Set(rows.map((r) => I.brandCode(r.brandId)))).toEqual(new Set(["HMNL"]));
    // asking for another brand cannot widen
    expect((await listProducts(exec, { brandId: I.brand("SNMNL") })).rows).toEqual([]);
    expect((await leadFormLookups(exec)).products.every((p) => p.brandId === I.brand("HMNL"))).toBe(true);
    await expect(getProduct(exec, snmnlProduct.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("scopedDb filters brand-tagged models even without an explicit where; RLS filters raw SQL", async () => {
    const db = scopedDb(exec);
    expect(await db.product.count()).toBe(26);
    expect(await db.product.findUnique({ where: { id: snmnlProduct.id } })).toBeNull();
    expect((await db.priceBook.findMany()).every((b) => b.brandId === I.brand("HMNL"))).toBe(true);
    expect((await db.vehicleUnit.findMany()).every((s) => s.brandId === I.brand("HMNL"))).toBe(true);
    const raw = await rawAsUser<{ brandId: string }>(exec, `SELECT "brandId" FROM "Product"`);
    expect(raw).toHaveLength(26);
    expect(await rawAsUser(exec, `SELECT e.id FROM "PriceBookEntry" e JOIN "PriceBook" b ON b.id = e."priceBookId" WHERE b."brandId" <> '${I.brand("HMNL")}'`)).toEqual([]);
    expect((await rawAsUser(exec, `SELECT id FROM "PriceBookEntry"`)).length).toBe(6);
    // management sees all brands
    expect((await listProducts(await ctxFor("md"), { take: 500 })).total).toBe(130);
    // regional exec selling all brands in Abuja sees all active brands' products
    expect((await listProducts(await ctxFor("exec.abuja"), { take: 500 })).total).toBe(130);
    expect((await listPriceBooks(exec)).map((b) => I.brandCode(b.brandId))).toEqual(["HMNL"]);
  });
});

describe("who can manage the catalogue", () => {
  const input = { code: "NEW-ONE", model: "Hatchback", variant: "Base", listPrice: 18_000_000 };

  it("Brand Manager manages own brand; not another brand; exec and management are read-only; admin all", async () => {
    await expect(svc.createProduct(exec, I.brand("HMNL"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createProduct(await ctxFor("md"), I.brand("HMNL"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createProduct(bm, I.brand("SNMNL"), input)).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await svc.createProduct(bm, I.brand("HMNL"), input);
    expect((await getProduct(bm, id)).name).toBe("Hatchback Base");
    await svc.updateProduct(bm, id, { ...input, variant: "Sport", active: false });
    expect((await getProduct(exec, id)).active).toBe(false);
    expect((await listProducts(exec, { activeOnly: true, take: 500 })).rows.map((r) => r.id)).not.toContain(id);
    await svc.createProduct(admin, I.brand("ZANL"), input); // same code in another brand is fine
    await expect(svc.createProduct(admin, I.brand("ZANL"), input)).rejects.toThrow(); // unique per brand
    expect(await unsafeDb.auditLog.count({ where: { entity: "Product", entityId: id } })).toBe(2);
  });
});

describe("price books", () => {
  it("validity dates are respected and overlapping default books are rejected", async () => {
    // seed book: default, 2026-01-01 … 2026-12-31
    await expect(svc.createPriceBook(bm, I.brand("HMNL"), { name: "Overlap", validFrom: "2026-06-01", validTo: "", isDefault: true, active: true } as never)).rejects.toThrow(/default price book/);
    const next = await svc.createPriceBook(bm, I.brand("HMNL"), { name: "2027 Price List", validFrom: "2027-01-01", validTo: "", isDefault: true, active: true } as never);
    await svc.upsertEntry(bm, next.id, { productId: hmnlProduct.id, price: 99_000_000, maxDiscountPct: 2 });

    const list = Number(String(hmnlProduct.listPrice));
    const p2026 = await getPrice(exec, hmnlProduct.id, new Date("2026-10-04T00:00:00Z"));
    expect(p2026).toMatchObject({ price: list, source: "priceBook", priceBookId: hmnlBook.id });
    const p2027 = await getPrice(exec, hmnlProduct.id, new Date("2027-02-01T00:00:00Z"));
    expect(p2027).toMatchObject({ price: 99_000_000, source: "priceBook", priceBookId: next.id, maxDiscountPct: 2 });
    // before any book is valid → list price
    expect(await getPrice(exec, hmnlProduct.id, new Date("2025-06-01T00:00:00Z"))).toMatchObject({ price: list, source: "listPrice" });
    // an explicitly chosen (non-default) book wins when valid
    const promo = await svc.createPriceBook(bm, I.brand("HMNL"), { name: "October promo", validFrom: "2026-10-01", validTo: "2026-10-31", isDefault: false, active: true } as never);
    await svc.upsertEntry(bm, promo.id, { productId: hmnlProduct.id, price: 1_000 });
    expect((await getPrice(exec, hmnlProduct.id, new Date("2026-10-04T00:00:00Z"), promo.id)).price).toBe(1_000);
    expect((await getPrice(exec, hmnlProduct.id, new Date("2026-11-04T00:00:00Z"), promo.id)).priceBookId).toBe(hmnlBook.id); // expired → default
  });

  it("an entry can only reference a product of the price book's brand (service and DB trigger)", async () => {
    await expect(svc.upsertEntry(admin, hmnlBook.id, { productId: snmnlProduct.id, price: 1 })).rejects.toThrow(/record's brand/);
    await expect(unsafeDb.priceBookEntry.create({ data: { priceBookId: hmnlBook.id, productId: snmnlProduct.id, price: 1 } })).rejects.toThrow(/another brand/);
    await expect(svc.upsertEntry(exec, hmnlBook.id, { productId: hmnlProduct.id, price: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("CSV import: dry run validates codes within the brand; commit applies valid rows only", async () => {
    const snmnlCode = (await unsafeDb.product.findUniqueOrThrow({ where: { id: snmnlProduct.id } })).code;
    const csv = `code,price,max_discount_pct,notes\n${hmnlProduct.code},"41,000,000",4,Q4 price\n${snmnlCode},5,,\nHMNL-NOPE,10,,\n${hmnlProduct.code},1,,dup\n`;
    const plan = await svc.dryRunPriceImport(bm, hmnlBook.id, csv);
    expect(plan.rows.map((r) => r.error)).toEqual([null, "Unknown product code for this brand", "Unknown product code for this brand", "Duplicate code in file"]);
    expect(plan.rows[0]).toMatchObject({ price: 41_000_000, action: "update" });
    const before = (await getPriceBook(bm, hmnlBook.id)).entries.find((e) => e.productId === hmnlProduct.id)!.price;
    expect(before).not.toBe(41_000_000); // dry run wrote nothing
    expect(await svc.commitPriceImport(bm, hmnlBook.id, csv)).toEqual({ applied: 1, skipped: 3 });
    expect((await getPriceBook(bm, hmnlBook.id)).entries.find((e) => e.productId === hmnlProduct.id)).toMatchObject({ price: 41_000_000, maxDiscountPct: 4, notes: "Q4 price" });
    await expect(svc.dryRunPriceImport(exec, hmnlBook.id, csv)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.exportPriceBook(exec, hmnlBook.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc.exportPriceBook(bm, hmnlBook.id)).csv).toContain(hmnlProduct.code);
  });
});

describe("VIN reservation", () => {
  it("reserve from a deal (same brand only), release on Closed Lost, sold on Closed Won", async () => {
    const { id: dealId } = await createDeal(exec, { name: "Reservation deal", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    const [stock] = await listStock(exec, { status: "AVAILABLE" });
    const foreign = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(svc.reserveVin(exec, dealId, foreign.id)).rejects.toThrow(/record's brand/);

    await svc.reserveVin(exec, dealId, stock!.id);
    expect(await unsafeDb.vehicleUnit.findUniqueOrThrow({ where: { id: stock!.id } })).toMatchObject({ status: "RESERVED", dealId });
    expect((await getDeal(exec, dealId)).vinChassisNo).toBe(stock!.vin);
    // someone else cannot reserve the same vehicle
    const other = await createDeal(exec, { name: "Second deal", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    await expect(svc.reserveVin(exec, other.id, stock!.id)).rejects.toThrow(/not available/);

    const pipeline = await unsafeDb.pipeline.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, include: { stages: true } });
    const lost = pipeline.stages.find((s) => s.type === "LOST")!;
    await moveDealStage(exec, dealId, lost.id, { lossReason: "Changed mind" } as never);
    expect(await unsafeDb.vehicleUnit.findUniqueOrThrow({ where: { id: stock!.id } })).toMatchObject({ status: "AVAILABLE", dealId: null });

    // Closed Won keeps the vehicle for the customer: the reservation no longer expires (brand manager may jump stages)
    await svc.reserveVin(exec, other.id, stock!.id);
    const won = pipeline.stages.find((s) => s.type === "WON")!;
    await moveDealStage(bm, other.id, won.id);
    expect(await unsafeDb.vehicleUnit.findUniqueOrThrow({ where: { id: stock!.id } })).toMatchObject({ status: "RESERVED", dealId: other.id, reservedUntil: null });
  });

  it("only the brand's manager adds stock; VIN unique per brand", async () => {
    await expect(svc.addStock(exec, { productId: hmnlProduct.id, vin: "NEWVIN0001" })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.addStock(bm, { productId: hmnlProduct.id, vin: "newvin0001", colour: "Red" });
    await expect(svc.addStock(bm, { productId: hmnlProduct.id, vin: "NEWVIN0001" })).rejects.toThrow(/already exists/);
  });
});
