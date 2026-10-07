import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { getProduct, productFormLookups } from "@/server/modules/catalogue/queries";
import * as svc from "@/server/modules/catalogue/service";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** Create Product page fields: owner, product name, vendor, manufacturer, taxable / tax, stock quantities. */
let bm: AccessContext;
let I: Awaited<ReturnType<typeof ids>>;
const code = () => `PF-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

beforeAll(async () => {
  I = await ids();
  bm = await ctxFor("bm.hmnl");
});

describe("create product page fields", () => {
  it("product name, owner (default: creator), manufacturer (default: the brand), vendor of the brand, stock quantities", async () => {
    const vendor = await unsafeDb.vendor.findFirstOrThrow({ where: { brandId: I.brand("HMNL") } });
    const p = await svc.createProduct(bm, I.brand("HMNL"), { code: code(), name: "Roof rack", category: "ACCESSORY", description: "Aluminium roof rack", preferredVendorId: vendor.id, qtyInStock: 12, qtyOrdered: 4, listPrice: 85_000 } as never);
    const row = await getProduct(bm, p.id);
    expect(row).toMatchObject({ name: "Roof rack", model: "Roof rack", ownerId: bm.userId, preferredVendorId: vendor.id, qtyInStock: 12, qtyOrdered: 4, taxable: true });
    expect(row.manufacturer).toBe((await unsafeDb.brand.findUniqueOrThrow({ where: { id: I.brand("HMNL") } })).name);
  });

  it("not taxable: no tax; another brand's vendor or an owner without access is rejected; a name is required", async () => {
    const p = await svc.createProduct(bm, I.brand("HMNL"), { code: code(), name: "Service plan", category: "SERVICE_PACKAGE", taxable: false, taxRatePct: 7.5 } as never);
    expect(await getProduct(bm, p.id)).toMatchObject({ taxable: false, taxRatePct: 0, taxCode: "NONE" });
    const snVendor = await unsafeDb.vendor.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(svc.createProduct(bm, I.brand("HMNL"), { code: code(), name: "X", preferredVendorId: snVendor.id } as never)).rejects.toThrow(/vendor/);
    const snExec = await ctxFor("exec.snmnl.1");
    await expect(svc.createProduct(bm, I.brand("HMNL"), { code: code(), name: "X", ownerId: snExec.userId } as never)).rejects.toThrow(/owner/);
    await expect(svc.createProduct(bm, I.brand("HMNL"), { code: code() } as never)).rejects.toThrow(/product name/);
  });

  it("lookups: only the brand's vendors and users; the brand's taxes; manufacturers end with Other", async () => {
    const l = await productFormLookups(bm, [I.brand("HMNL")]);
    expect(l.vendors.every((v) => v.brandId === I.brand("HMNL"))).toBe(true);
    expect(l.owners.some((o) => o.id === bm.userId)).toBe(true);
    expect(l.taxes[I.brand("HMNL")]!.length).toBeGreaterThan(0);
    expect(l.manufacturers.at(-1)).toBe("Other");
  });
});
