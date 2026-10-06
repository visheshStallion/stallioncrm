import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import * as inv from "@/server/modules/inventory/service";
import * as po from "@/server/modules/inventory/purchase-orders";
import { saveSetting } from "@/server/modules/setup/service";
import { BadRequestError } from "@/server/errors";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** The Create Purchase Order page (prompt 25 §9) on the server: defaults, currency, brand checks, approval, locks. */
type C = AccessContext;
let I: Awaited<ReturnType<typeof ids>>;
let logistics: C; // HMNL logistics officer (cost access)
let stock: C; // HMNL stock controller (no cost access)
let bm: C;
let snLogistics: C; // SNMNL stock controller
let exec: C;
let admin: C;
let ba: C;
let vendor: string;
let snVendor: string;
let model: { id: string };
let yard: string;
const HMNL = () => I.brand("HMNL");
const SNMNL = () => I.brand("SNMNL");

const base = (over: Record<string, unknown> = {}) => ({
  brandId: HMNL(),
  subject: "Parts restock",
  vendorId: vendor,
  lines: [{ productId: model.id, description: "Model", qty: 2, unitPrice: 1_000_000, discountType: "PERCENT", discountValue: 10, taxes: [{ name: "VAT", rate: 7.5 }] }],
  ...over,
});

beforeAll(async () => {
  I = await ids();
  [logistics, stock, bm, snLogistics, exec, admin, ba] = (await Promise.all(["logistics.hmnl", "stock.hmnl", "bm.hmnl", "stock.snmnl", "exec.hmnl.1", "admin", "ba.hmnl"].map(ctxFor))) as C[] as [C, C, C, C, C, C, C];
  vendor = (await unsafeDb.vendor.findFirstOrThrow({ where: { brandId: HMNL(), type: "OEM" } })).id;
  snVendor = (await unsafeDb.vendor.findFirstOrThrow({ where: { brandId: SNMNL() } })).id;
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: HMNL(), category: "VEHICLE" }, orderBy: { code: "asc" } });
  yard = (await unsafeDb.warehouse.findFirstOrThrow({ where: { brandId: HMNL(), code: "LAG-YARD" } })).id;
  await saveSetting(admin, "currencies", { home: "NGN", rates: { USD: 1500, EUR: 1650 }, rounding: 2 });
  await unsafeDb.inventorySettings.update({ where: { brandId: HMNL() }, data: { poApprovalLimit: 50_000_000, addExciseToTotal: false, allowManualPoNumber: false } });
});

describe("purchase order page", () => {
  it("owner defaults to the creator, Status Created, NGN at rate 1, totals from the grid", async () => {
    const res = await po.savePurchaseOrder(logistics, null, base({ billTo: { country: "Nigeria", state: "Lagos" } }));
    expect(res.number).toMatch(/^HMNL-PO-\d{4}-\d{5}$/);
    const d = await po.getPurchaseOrder(logistics, res.id);
    expect(d.owner?.id).toBe(logistics.userId);
    expect(d.statusLabel).toBe("Created");
    expect(d.currency).toBe("NGN");
    expect(d.exchangeRate).toBe(1);
    expect(d.poDate).toBe(new Date().toISOString().slice(0, 10));
    // 2 × 1,000,000 − 10 % = 1,800,000 + 7.5 % VAT = 1,935,000
    expect(d.total).toBe(1_935_000);
    expect(d.billTo.country).toBe("Nigeria");
    const row = await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: res.id } });
    expect(Number(row.subTotal)).toBe(1_935_000);
    expect(Number(row.discountTotal)).toBe(200_000);
    expect(Number(row.taxTotal)).toBe(135_000);
  });

  it("USD takes the rate from Setup → Currencies; only finance can type another rate", async () => {
    const a = await po.savePurchaseOrder(logistics, null, base({ currency: "USD", exchangeRate: 2000 }));
    expect((await po.getPurchaseOrder(logistics, a.id)).exchangeRate).toBe(1500); // logistics may not edit the rate
    const b = await po.savePurchaseOrder(admin, null, base({ currency: "USD", exchangeRate: 1600 }));
    expect((await po.getPurchaseOrder(admin, b.id)).exchangeRate).toBe(1600);
    await expect(po.savePurchaseOrder(logistics, null, base({ currency: "JPY" }))).rejects.toThrow(/no exchange rate/);
  });

  it("required fields and rules: subject, vendor, an item, due date ≥ PO date, carrier from the list", async () => {
    await expect(po.savePurchaseOrder(logistics, null, base({ subject: "" }))).rejects.toThrow(/subject/i);
    await expect(po.savePurchaseOrder(logistics, null, base({ vendorId: "" }))).rejects.toThrow(/vendor/i);
    await expect(po.savePurchaseOrder(logistics, null, base({ lines: [] }))).rejects.toThrow(/purchase item/);
    await expect(po.savePurchaseOrder(logistics, null, base({ poDate: "2026-10-05", dueDate: "2026-10-01" }))).rejects.toThrow(/due date/);
    await expect(po.savePurchaseOrder(logistics, null, base({ carrier: "Pigeon" }))).rejects.toThrow(/carrier/);
    const ok = await po.savePurchaseOrder(logistics, null, base({ carrier: "DHL", trackingNumber: "BL-1", requisitionNumber: "REQ-7" }));
    expect((await po.getPurchaseOrder(logistics, ok.id)).carrier).toBe("DHL");
  });

  it("brand isolation: another brand's vendor, product or warehouse is rejected; other brands cannot see the PO", async () => {
    await expect(po.savePurchaseOrder(logistics, null, base({ vendorId: snVendor }))).rejects.toThrow(/vendor does not belong/);
    const snProduct = await unsafeDb.product.findFirstOrThrow({ where: { brandId: SNMNL() } });
    await expect(po.savePurchaseOrder(logistics, null, base({ lines: [{ productId: snProduct.id, description: "x", qty: 1, unitPrice: 1 }] }))).rejects.toThrow(/does not belong to this brand/);
    const snWh = await unsafeDb.warehouse.findFirstOrThrow({ where: { brandId: SNMNL() } });
    await expect(po.savePurchaseOrder(logistics, null, base({ warehouseId: snWh.id }))).rejects.toThrow(/warehouse/);
    await expect(po.savePurchaseOrder(snLogistics, null, base())).rejects.toBeInstanceOf(ForbiddenError);
    const mine = await po.savePurchaseOrder(logistics, null, base());
    await expect(po.getPurchaseOrder(snLogistics, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    // lookups never list another brand's records
    const products = await po.poProducts(logistics, HMNL(), vendor);
    const brands = await unsafeDb.product.findMany({ where: { id: { in: products.map((p) => p.id) } }, select: { brandId: true } });
    expect(brands.every((b) => b.brandId === HMNL())).toBe(true);
    const form = await po.poFormData(logistics, HMNL());
    expect(form.vendors.map((v) => v.id)).not.toContain(snVendor);
    await expect(po.poFormData(logistics, SNMNL())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sales execs cannot create purchase orders; a stock controller's prices are the system's", async () => {
    await expect(po.savePurchaseOrder(exec, null, base())).rejects.toBeInstanceOf(ForbiddenError);
    await unsafeDb.product.update({ where: { id: model.id }, data: { costPrice: 900_000 } });
    const res = await po.savePurchaseOrder(stock, null, base());
    const line = await unsafeDb.inventoryDocumentLine.findFirstOrThrow({ where: { documentId: res.id } });
    expect(Number(line.unitCost)).toBe(900_000);
    expect(Number(line.discountValue)).toBe(0);
    expect((await po.getPurchaseOrder(stock, res.id)).total).toBeNull(); // no costs shown
  });

  it("contact must belong to the vendor; excise is added to the total only when the brand says so; typed numbers only when allowed", async () => {
    const contact = await unsafeDb.vendorContact.create({ data: { brandId: HMNL(), vendorId: vendor, name: "Test Contact" } });
    const other = await unsafeDb.vendor.create({ data: { brandId: HMNL(), name: `Other vendor ${Date.now()}` } });
    await expect(po.savePurchaseOrder(logistics, null, base({ vendorId: other.id, vendorContactId: contact.id }))).rejects.toThrow(/contact does not belong/);
    const a = await po.savePurchaseOrder(logistics, null, base({ vendorContactId: contact.id, exciseDuty: 50_000 }));
    expect((await po.getPurchaseOrder(logistics, a.id)).total).toBe(1_935_000);
    await unsafeDb.inventorySettings.update({ where: { brandId: HMNL() }, data: { addExciseToTotal: true } });
    const b = await po.savePurchaseOrder(logistics, null, base({ exciseDuty: 50_000 }));
    expect((await po.getPurchaseOrder(logistics, b.id)).total).toBe(1_985_000);
    await unsafeDb.inventorySettings.update({ where: { brandId: HMNL() }, data: { addExciseToTotal: false } });

    const typed = `EXT-${Date.now()}`;
    await expect(po.savePurchaseOrder(logistics, null, base({ number: typed }))).rejects.toBeInstanceOf(BadRequestError);
    await unsafeDb.inventorySettings.update({ where: { brandId: HMNL() }, data: { allowManualPoNumber: true } });
    expect((await po.savePurchaseOrder(logistics, null, base({ number: typed }))).number).toBe(typed);
    await expect(po.savePurchaseOrder(logistics, null, base({ number: typed }))).rejects.toThrow(/already used/);
    await unsafeDb.inventorySettings.update({ where: { brandId: HMNL() }, data: { allowManualPoNumber: false } });
  });

  it("above the threshold → Pending Approval; lines lock once Approved; BM reopens; send → Sent to Vendor; receipt still works", async () => {
    const big = await po.savePurchaseOrder(logistics, null, base({ lines: [{ productId: model.id, description: "Model", qty: 2, unitPrice: 30_000_000, taxes: [] }] }));
    expect((await inv.transition(logistics, big.id, "submit")).status).toBe("PENDING_APPROVAL");
    expect((await inv.transition(bm, big.id, "approve")).status).toBe("ISSUED");
    expect((await po.getPurchaseOrder(logistics, big.id)).statusLabel).toBe("Approved");
    await expect(po.savePurchaseOrder(logistics, big.id, base())).rejects.toThrow(/locked/);
    await expect(inv.transition(logistics, big.id, "reopen")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await inv.transition(bm, big.id, "reopen")).status).toBe("DRAFT");
    await po.savePurchaseOrder(logistics, big.id, base({ subject: "Changed after reopening", lines: [{ productId: model.id, description: "Model", qty: 1, unitPrice: 20_000_000, taxes: [] }] }));
    expect((await inv.transition(logistics, big.id, "submit")).status).toBe("ISSUED"); // 20m is below the limit
    const sent = await inv.transition(logistics, big.id, "send");
    expect(sent.status).toBe("SENT");
    expect((await po.getPurchaseOrder(logistics, big.id)).statusLabel).toBe("Sent to Vendor");
    await expect(inv.transition(logistics, big.id, "cancel")).rejects.toThrow(); // cancel only from Created / Approved
    // the GRN values the vehicle at the PO's net price
    const vin = `TESTPO25RA9${String(Date.now()).slice(-6)}`;
    const { makeVin } = await import("@/server/modules/inventory/vin");
    const grn = await inv.createInvDocument(stock, "GRN", { brandId: HMNL(), vendorId: vendor, warehouseId: yard, parentId: big.id, lines: [{ productId: model.id, vin: makeVin(vin) }] });
    await inv.transition(stock, grn.id, "receive");
    expect((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: big.id } })).status).toBe("RECEIVED");
    const unit = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { vin: makeVin(vin) } });
    expect(Number(unit.purchaseCost)).toBe(20_000_000);
  });

  it("settings and custom form views: administrators and Brand Admins only", async () => {
    await expect(po.savePoSettings(logistics, HMNL(), { carriers: "DHL", addExciseToTotal: false, allowManualPoNumber: false, poApprovalLimit: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await po.savePoSettings(ba, HMNL(), { carriers: "FedEx\nDHL\nUPS\nGIG Logistics\nRed Star Express\nShipping line\nOwn transport\nOther", poTerms: "Delivery within 30 days.", addExciseToTotal: false, allowManualPoNumber: false, receivingWarehouseId: yard, poApprovalLimit: 50_000_000 });
    expect((await po.poSettings(logistics, HMNL())).terms).toBe("Delivery within 30 days.");
    await expect(po.savePoSettings(ba, SNMNL(), { carriers: "DHL", addExciseToTotal: false, allowManualPoNumber: false, poApprovalLimit: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(po.savePoFormView(logistics, HMNL(), { name: "Import PO view", hidden: [] })).rejects.toBeInstanceOf(ForbiddenError);
    const view = await po.savePoFormView(admin, HMNL(), { name: `Import PO view ${Date.now()}`, hidden: ["salesCommission", "address", "nonsense"] });
    const saved = (await po.poSettings(admin, HMNL())).formViews.find((v) => v.id === view.id)!;
    expect(saved.hidden).toEqual(["salesCommission", "address"]);
    const res = await po.savePurchaseOrder(logistics, null, base({ formViewId: view.id }));
    expect((await po.getPurchaseOrder(logistics, res.id)).formViewId).toBe(view.id);
    await po.deletePoFormView(admin, HMNL(), view.id);
  });
});
