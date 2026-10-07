import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import * as campaigns from "@/server/modules/messaging/campaigns";
import { getVendor } from "@/server/modules/inventory/queries";
import * as inv from "@/server/modules/inventory/service";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** Create Campaign and Create Vendor page fields. */
let bm: AccessContext;
let logistics: AccessContext;
let snStock: AccessContext;
let I: Awaited<ReturnType<typeof ids>>;

beforeAll(async () => {
  I = await ids();
  [bm, logistics, snStock] = (await Promise.all(["bm.hmnl", "logistics.hmnl", "stock.snmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext];
});

describe("campaign page fields", () => {
  it("type, planning status, expected revenue, budgeted / actual cost, expected response, numbers sent, currency, description", async () => {
    const c = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: `Webinar ${Date.now()}`, type: "WEBINAR", channel: "EMAIL", planStatus: "Planning", expectedRevenue: "5000000", budget: "250000", actualCost: "180000", expectedResponse: "40", numbersSent: "1200", currency: "NGN", description: "Launch webinar", startDate: "2026-11-01", endDate: "2026-11-30" });
    const row = await campaigns.getCampaign(bm, c.id);
    expect(row).toMatchObject({ type: "WEBINAR", planStatus: "Planning", expectedResponse: 40, numbersSent: 1200, currency: "NGN", description: "Launch webinar", ownerId: bm.userId });
    expect(Number(row.expectedRevenue)).toBe(5_000_000);
    expect(Number(row.actualCost)).toBe(180_000);
    await expect(campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: "x", channel: "SMS", startDate: "2026-11-30", endDate: "2026-11-01" })).rejects.toThrow(/end date/);
    await expect(campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: "x", channel: "SMS", planStatus: "Bogus" })).rejects.toThrow();
  });
});

describe("vendor page fields", () => {
  it("owner, website, GL account, category, e-mail opt-out, address, description; the short settings form keeps them", async () => {
    const res = await inv.saveVendor(logistics, null, { page: true, brandId: I.brand("HMNL"), type: "PARTS_SUPPLIER", name: `Lagos Parts ${Date.now()}`, phone: "+2348000000000", email: "parts@example.test", website: "www.lagosparts.example", glAccount: "Purchases – Spare parts", category: "Parts", emailOptOut: true, city: "Lagos", state: "Lagos", zipCode: "100001", country: "Nigeria", description: "Genuine parts", currency: "NGN", active: true } as never);
    const v = await getVendor(logistics, res.id);
    expect(v).toMatchObject({ ownerId: logistics.userId, website: "https://www.lagosparts.example", glAccount: "Purchases – Spare parts", category: "Parts", emailOptOut: true, city: "Lagos", zipCode: "100001", country: "Nigeria", description: "Genuine parts" });
    // the short vendor form of Inventory settings changes the basics only
    await inv.saveVendor(logistics, res.id, { brandId: I.brand("HMNL"), type: "PARTS_SUPPLIER", name: v.name, currency: "NGN", active: true });
    expect((await getVendor(logistics, res.id)).glAccount).toBe("Purchases – Spare parts");
    await expect(getVendor(snStock, res.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getVendor(await ctxFor("exec.hmnl.1"), res.id)).rejects.toBeInstanceOf(NotFoundError);
    const snExec = await ctxFor("exec.snmnl.1");
    await expect(inv.saveVendor(logistics, null, { page: true, brandId: I.brand("HMNL"), type: "OEM", name: `Owner check ${Date.now()}`, ownerId: snExec.userId, currency: "NGN", active: true } as never)).rejects.toThrow(/owner/);
    await expect(inv.saveVendor(await ctxFor("exec.hmnl.1"), null, { page: true, brandId: I.brand("HMNL"), type: "OEM", name: "Not allowed", currency: "NGN", active: true } as never)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await unsafeDb.vendor.count({ where: { id: res.id, imageData: null } })).toBe(1);
  });
});

describe("price book page fields", () => {
  it("owner, pricing model, naira, description; the quick edit on the record page keeps them", async () => {
    const svc = await import("@/server/modules/catalogue/service");
    const b = await svc.createPriceBook(bm, I.brand("HMNL"), { name: `Fleet ${Date.now()}`, validFrom: "2026-10-01", active: true, isDefault: false, pricingModel: "FLAT", naira: "150000", description: "Fleet" } as never);
    let row = await unsafeDb.priceBook.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({ ownerId: bm.userId, pricingModel: "FLAT", description: "Fleet" });
    expect(Number(row.naira)).toBe(150_000);
    await svc.updatePriceBook(bm, b.id, { name: row.name, validFrom: "2026-10-01", active: true, isDefault: false } as never);
    row = await unsafeDb.priceBook.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.pricingModel).toBe("FLAT");
    await expect(svc.createPriceBook(bm, I.brand("HMNL"), { name: `Bad ${Date.now()}`, validFrom: "2026-10-01", pricingModel: "TIERED" } as never)).rejects.toThrow();
  });
});
