import { describe, expect, it } from "vitest";
import { assertSameBrand, brandTagWhere, canManageBrandData } from "@/server/access/brand-tag";
import { ForbiddenError } from "@/server/access/errors";
import { defaultBookFor, overlappingDefaults, rangesOverlap, resolve, validOn, type BookLike } from "@/server/modules/catalogue/pricing";
import { productSchema } from "@/server/modules/catalogue/schema";
import { B, CTX } from "../../fixtures/contexts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const book = (id: string, from: string, to: string | null, over: Partial<BookLike> = {}): BookLike => ({ id, brandId: "b1", validFrom: d(from), validTo: to ? d(to) : null, active: true, isDefault: true, ...over });

describe("price book validity", () => {
  it("validity dates are inclusive; open-ended books never expire; inactive books are never valid", () => {
    const b = book("1", "2026-01-01", "2026-06-30");
    expect(validOn(b, d("2026-01-01"))).toBe(true);
    expect(validOn(b, d("2026-06-30"))).toBe(true);
    expect(validOn(b, d("2026-07-01"))).toBe(false);
    expect(validOn(b, d("2025-12-31"))).toBe(false);
    expect(validOn(book("2", "2026-01-01", null), d("2030-01-01"))).toBe(true);
    expect(validOn(book("3", "2026-01-01", null, { active: false }), d("2026-02-01"))).toBe(false);
  });

  it("detects overlapping ranges", () => {
    expect(rangesOverlap(book("a", "2026-01-01", "2026-06-30"), book("b", "2026-06-30", "2026-12-31"))).toBe(true);
    expect(rangesOverlap(book("a", "2026-01-01", "2026-06-30"), book("b", "2026-07-01", null))).toBe(false);
    expect(rangesOverlap(book("a", "2026-01-01", null), book("b", "2027-01-01", null))).toBe(true);
  });

  it("overlapping DEFAULT books of the same brand are rejected; other cases are fine", () => {
    const h1 = book("h1", "2026-01-01", "2026-06-30");
    const others = [h1, book("x", "2026-01-01", null, { brandId: "b2" }), book("promo", "2026-03-01", "2026-03-31", { isDefault: false })];
    expect(overlappingDefaults(book("new", "2026-06-01", null), others).map((o) => o.id)).toEqual(["h1"]);
    expect(overlappingDefaults(book("new", "2026-07-01", null), others)).toEqual([]);
    expect(overlappingDefaults(book("new", "2026-06-01", null, { isDefault: false }), others)).toEqual([]);
    expect(overlappingDefaults(book("new", "2026-06-01", null, { active: false }), others)).toEqual([]);
    expect(overlappingDefaults({ ...h1, validTo: d("2026-12-31") }, others)).toEqual([]); // editing itself
  });

  it("default book for a date", () => {
    const books = [book("h1", "2026-01-01", "2026-06-30"), book("h2", "2026-07-01", null), book("other", "2026-01-01", null, { brandId: "b2" })];
    expect(defaultBookFor(books, "b1", d("2026-03-01"))?.id).toBe("h1");
    expect(defaultBookFor(books, "b1", d("2026-09-01"))?.id).toBe("h2");
    expect(defaultBookFor(books, "b1", d("2025-09-01"))).toBeNull();
  });

  it("price resolution: price book entry, else list price; tax applied", () => {
    expect(resolve({ listPrice: 100, taxRatePct: 7.5 }, { price: 90, maxDiscountPct: 5, priceBookId: "pb" })).toEqual({ price: 90, source: "priceBook", priceBookId: "pb", maxDiscountPct: 5, taxRatePct: 7.5, gross: 96.75 });
    expect(resolve({ listPrice: 100, taxRatePct: 7.5 }, null)).toMatchObject({ price: 100, source: "listPrice", gross: 107.5 });
    expect(resolve({ listPrice: null, taxRatePct: 7.5 }, null)).toMatchObject({ price: null, source: "none", gross: null });
  });
});

describe("brand-tagged access", () => {
  const bm = { ...CTX.bmHmnl, memberships: CTX.bmHmnl.memberships.map((m) => ({ ...m, isManager: true })) };

  it("assertSameBrand: lookup filter enforcement", () => {
    expect(() => assertSameBrand("b1", "b1")).not.toThrow();
    expect(() => assertSameBrand("b1", "b2")).toThrow(ForbiddenError);
    expect(() => assertSameBrand("b1", null)).toThrow(/record's brand/); // missing or invisible reference
  });

  it("brandTagWhere: users see their brands; scope ALL sees everything", () => {
    expect(brandTagWhere(CTX.md)).toEqual({});
    expect(brandTagWhere(CTX.lagosMulti)).toEqual({ brandId: { in: [B("HMNL"), B("SNMNL")] } });
    expect(brandTagWhere(CTX.noTerritory)).toEqual({ brandId: { in: [] } });
  });

  it("Brand Manager manages own brand only; exec and management cannot edit; admin can", () => {
    expect(canManageBrandData(bm, "products", "edit", B("HMNL"))).toBe(true);
    expect(canManageBrandData(bm, "products", "edit", B("SNMNL"))).toBe(false);
    expect(canManageBrandData(CTX.lagosHmnl, "products", "edit", B("HMNL"))).toBe(false);
    expect(canManageBrandData(CTX.md, "priceBooks", "edit", B("HMNL"))).toBe(false);
    expect(canManageBrandData(CTX.admin, "priceBooks", "create", B("ZANL"))).toBe(true);
  });
});

describe("product schema", () => {
  it("normalises code, lists and defaults; rejects non-http URLs", () => {
    const p = productSchema.parse({ code: "hmnl-suv-x", model: "SUV", colours: "White, Black\nBlue", imageUrls: "https://example.test/a.png", listPrice: "" });
    expect(p.code).toBe("HMNL-SUV-X");
    expect(p.colours).toEqual(["White", "Black", "Blue"]);
    expect(p.taxRatePct).toBe(7.5);
    expect(p.listPrice).toBeNull();
    expect(() => productSchema.parse({ code: "X1", model: "M", imageUrls: "javascript:alert(1)" })).toThrow();
    expect(() => productSchema.parse({ code: "X1", model: "M", specSheetUrl: "ftp://x/y.pdf" })).toThrow();
  });
});
