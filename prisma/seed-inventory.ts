/**
 * Fictitious inventory for the seed (prompt 16 §9), per active brand: 3 warehouses, an OEM vendor and a
 * clearing agent, 40 vehicles across the lifecycle with VINs that pass the check-digit validation, 20 parts
 * with reorder levels and one shipment with landed cost allocated. The ledger, the balances and the journals
 * are written consistently (what a goods receipt and a landed cost voucher would have posted).
 */
import type { PrismaClient, VehicleStatus } from "@prisma/client";
import { allocateLandedCost, round2 } from "../src/server/modules/inventory/costing";
import { DEFAULT_ACCOUNTS, landedCostJournal, receiptJournal } from "../src/server/modules/inventory/journal";
import { makeVin } from "../src/server/modules/inventory/vin";
import { CATALOGUE_COLOURS } from "./seed-data";

const DAY = 86_400_000;
/** 40 units: 16 available, 4 awaiting PDI, 2 demo, 2 on hold (in stock) · 6 in transit, 4 at port, 3 in clearing, 3 on order */
const STATUS_PLAN: VehicleStatus[] = [
  ...Array<VehicleStatus>(16).fill("AVAILABLE"),
  ...Array<VehicleStatus>(4).fill("PDI_PENDING"),
  "DEMO", "DEMO", "ON_HOLD", "ON_HOLD",
  ...Array<VehicleStatus>(6).fill("IN_TRANSIT"),
  ...Array<VehicleStatus>(4).fill("AT_PORT"),
  ...Array<VehicleStatus>(3).fill("IN_CLEARING"),
  ...Array<VehicleStatus>(3).fill("ON_ORDER"),
];
const IN_STOCK = new Set<VehicleStatus>(["AVAILABLE", "PDI_PENDING", "DEMO", "ON_HOLD"]);
const PARTS = ["Oil filter", "Air filter", "Brake pads (front)", "Brake pads (rear)", "Wiper blades", "Spark plug set", "Battery 70Ah", "Engine oil 5W-30 (4 l)", "Coolant (5 l)", "Cabin filter", "Floor mats", "Mud flaps", "Roof rails", "Tow bar", "Alloy wheel 17\"", "Tyre 215/60 R17", "Headlamp bulb", "Fuel filter", "Drive belt", "Touch-up paint"];

export async function seedInventory(prisma: PrismaClient, input: { brands: Map<string, string>; regions: Map<string, string>; products: Map<string, string[]>; activeBrands: readonly string[]; baseDate: number }): Promise<void> {
  const { brands, regions, products, activeBrands, baseDate } = input;
  for (const [bi, code] of activeBrands.entries()) {
    const brandId = brands.get(code)!;
    await prisma.inventorySettings.create({ data: { brandId, accounts: DEFAULT_ACCOUNTS } });
    const wh = async (c: string, name: string, type: string, region: string) => (await prisma.warehouse.create({ data: { brandId, code: c, name: `${name} – ${code}`, type, regionId: regions.get(region) ?? null, address: `${region} (fictitious)` } })).id;
    const showroom = await wh("LAG-SHOW", "Lagos Showroom", "SHOWROOM", "Lagos");
    const yard = await wh("LAG-YARD", "Lagos Yard", "MAIN_YARD", "Lagos");
    const abuja = await wh("ABJ-SHOW", "Abuja Showroom", "SHOWROOM", "Abuja");
    const oem = await prisma.vendor.create({ data: { brandId, type: "OEM", name: `${code} Motor Corporation (fictitious)`, currency: "USD", paymentTerms: "LC 90 days", contactName: "Export desk", email: `export.${code.toLowerCase()}@example.test` } });
    const agent = await prisma.vendor.create({ data: { brandId, type: "CLEARING_AGENT", name: `Harbour Clearing Services – ${code} (fictitious)`, currency: "NGN", paymentTerms: "30 days", phone: "+2347000009999" } });

    // ── vehicles
    const productIds = products.get(code)!;
    const vehicles = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, listPrice: true, modelYear: true } });
    const balance = new Map<string, { qty: number; value: number }>();
    const bump = (productId: string, warehouseId: string, qty: number, value: number) => {
      const k = `${productId}|${warehouseId}`;
      const b = balance.get(k) ?? { qty: 0, value: 0 };
      balance.set(k, { qty: b.qty + qty, value: round2(b.value + value) });
    };
    let received = 0;
    const shipmentUnits: Array<{ id: string; productId: string; warehouseId: string; cost: number }> = [];
    const shipment = await prisma.inventoryDocument.create({ data: { brandId, type: "SHIPMENT", status: "DELIVERED", vendorId: oem.id, reference: `BL-${code}-0001`, docDate: new Date(baseDate - 60 * DAY), data: { vessel: "MV Example Trader", port: "Tin Can Island", container: "Ro-Ro" } } });
    for (const [i, status] of STATUS_PLAN.entries()) {
      const p = vehicles[i % vehicles.length]!;
      const vin = makeVin(`${`${code}XXXX`.slice(0, 4)}MD${i % 3}${i % 2}RA${String(bi * 1000 + i + 1).padStart(6, "0")}`);
      const stocked = IN_STOCK.has(status);
      const cost = round2(Number(p.listPrice ?? 30_000_000) * 0.8);
      const warehouseId = stocked ? [yard, showroom, abuja][i % 3]! : null;
      const receivedAt = stocked ? new Date(baseDate - ((i * 13) % 210) * DAY) : null;
      const unit = await prisma.vehicleUnit.create({
        data: { brandId, productId: p.id, vin, colour: CATALOGUE_COLOURS[i % CATALOGUE_COLOURS.length], modelYear: p.modelYear, status, warehouseId, purchaseCost: stocked ? cost : 0, receivedAt, pdiPassedAt: stocked && status !== "PDI_PENDING" ? receivedAt : null, isDemo: status === "DEMO", mileage: status === "DEMO" ? 1200 + i * 10 : null, damageNotes: status === "ON_HOLD" ? "Transport damage – bumper (fictitious)" : null, shipmentId: i < 8 ? shipment.id : null, sellingPrice: p.listPrice },
      });
      if (stocked && warehouseId) {
        await prisma.stockMovement.create({ data: { brandId, productId: p.id, vehicleUnitId: unit.id, warehouseId, qtyIn: 1, unitCost: cost, totalCost: cost, movementType: "OPENING", sourceDocType: "SEED", at: receivedAt! } });
        bump(p.id, warehouseId, 1, cost);
        received += cost;
        if (i < 8) shipmentUnits.push({ id: unit.id, productId: p.id, warehouseId, cost });
      }
    }

    // ── landed cost of the first shipment, allocated by value
    const charges = [
      { description: "Customs duty", amount: 9_600_000 },
      { description: "Port and terminal charges", amount: 1_450_000 },
      { description: "Clearing agent", amount: 800_000 },
      { description: "Haulage to yard", amount: 640_000 },
    ];
    const total = charges.reduce((s, c) => s + c.amount, 0);
    const shares = allocateLandedCost(total, shipmentUnits.map((u) => ({ id: u.id, value: u.cost })), "VALUE");
    const voucher = await prisma.inventoryDocument.create({
      data: { brandId, type: "LANDED_COST", status: "ALLOCATED", vendorId: agent.id, parentId: shipment.id, reference: `SGD-${code}-0001`, docDate: new Date(baseDate - 20 * DAY), postedAt: new Date(baseDate - 20 * DAY), total, data: { method: "VALUE", unitIds: shipmentUnits.map((u) => u.id), allocation: Object.fromEntries(shares) }, lines: { create: charges.map((c, i) => ({ position: i + 1, description: c.description, qty: 1, unitCost: c.amount, lineTotal: c.amount, data: { chargeType: c.description } })) } },
    });
    for (const u of shipmentUnits) {
      const share = shares.get(u.id) ?? 0;
      await prisma.vehicleUnit.update({ where: { id: u.id }, data: { landedCost: share } });
      await prisma.stockMovement.create({ data: { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, totalCost: share, movementType: "LANDED_COST", sourceDocType: "LANDED_COST", sourceDocId: voucher.id, at: new Date(baseDate - 20 * DAY) } });
      bump(u.productId, u.warehouseId, 0, share);
    }

    // ── parts and accessories (quantity tracked, weighted average)
    let partsValue = 0;
    for (const [i, name] of PARTS.entries()) {
      const cost = 4_000 + ((i * 7_919) % 90_000);
      const qty = i % 5 === 0 ? 2 : 10 + ((i * 7) % 40); // every fifth part is below its reorder level
      const part = await prisma.product.create({
        data: { brandId, code: `${code}-ZP-${String(i + 1).padStart(3, "0")}`, name: `${name} (${code})`, model: name, category: i >= 10 && i <= 14 ? "ACCESSORY" : "PART", listPrice: Math.round(cost * 1.4), colours: [], description: "Fictitious part for demo data.", trackingType: "NONE", valuationMethod: "WEIGHTED_AVERAGE", uom: "pc", reorderLevel: 5, reorderQty: 20, costPrice: cost, preferredVendorId: oem.id },
      });
      const value = round2(cost * qty);
      await prisma.stockMovement.create({ data: { brandId, productId: part.id, warehouseId: yard, qtyIn: qty, unitCost: cost, totalCost: value, movementType: "OPENING", sourceDocType: "SEED", at: new Date(baseDate - 45 * DAY) } });
      bump(part.id, yard, qty, value);
      partsValue += value;
    }

    await prisma.stockBalance.createMany({ data: [...balance].map(([k, b]) => ({ brandId, productId: k.split("|")[0]!, warehouseId: k.split("|")[1]!, qty: b.qty, value: b.value })) });

    // ── journals: opening stock and the landed cost voucher
    const post = async (date: Date, draft: ReturnType<typeof receiptJournal>, sourceDocType: string, sourceDocId: string | null) => {
      if (!draft) return;
      await prisma.journalEntry.create({ data: { brandId, date, memo: draft.memo, sourceDocType, sourceDocId, lines: { create: draft.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })) } } });
    };
    await post(new Date(baseDate - 45 * DAY), receiptJournal(DEFAULT_ACCOUNTS, "opening stock", round2(received + partsValue)), "SEED", null);
    await post(new Date(baseDate - 20 * DAY), landedCostJournal(DEFAULT_ACCOUNTS, voucher.number, total), "LANDED_COST", voucher.id);
  }
}
