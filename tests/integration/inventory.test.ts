import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { reserveVin } from "@/server/modules/catalogue/service";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import * as docs from "@/server/modules/documents/service";
import * as q from "@/server/modules/inventory/queries";
import { runInvReport } from "@/server/modules/inventory/reports";
import * as inv from "@/server/modules/inventory/service";
import { makeVin } from "@/server/modules/inventory/vin";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

type C = AccessContext;
let I: Awaited<ReturnType<typeof ids>>;
let stock: AccessContext; // HMNL stock controller (no cost)
let acct: AccessContext; // HMNL brand accountant
let logistics: AccessContext; // HMNL logistics officer
let bm: AccessContext; // HMNL brand manager
let exec: AccessContext; // HMNL Lagos exec
let exec2: AccessContext;
let snStock: AccessContext; // SNMNL stock controller
let snAcct: AccessContext;
let snBm: AccessContext;
let snExec: AccessContext;
let md: AccessContext;
let admin: AccessContext;
let model: { id: string; name: string };
let part: { id: string };
let yard: string;
let showroom: string;
let oem: string;
let seq = 0;
const vin = () => makeVin(`TESTMD01RA9${String(++seq).padStart(5, "0")}`);
const HMNL = () => I.brand("HMNL");

beforeAll(async () => {
  I = await ids();
  [stock, acct, logistics, bm, exec, exec2, snStock, snAcct, snBm, snExec, md, admin] = (await Promise.all(["stock.hmnl", "acct.hmnl", "logistics.hmnl", "bm.hmnl", "exec.hmnl.1", "exec.hmnl.2", "stock.snmnl", "acct.snmnl", "bm.snmnl", "exec.snmnl.1", "md", "admin"].map(ctxFor))) as unknown as [C, C, C, C, C, C, C, C, C, C, C, C];
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: HMNL(), category: "VEHICLE" }, orderBy: { code: "asc" } });
  part = await unsafeDb.product.findFirstOrThrow({ where: { brandId: HMNL(), category: "PART" }, orderBy: { code: "asc" }, skip: 1 }); // the first part is seeded below its reorder level
  const wh = await unsafeDb.warehouse.findMany({ where: { brandId: HMNL() } });
  yard = wh.find((w) => w.code === "LAG-YARD")!.id;
  showroom = wh.find((w) => w.code === "LAG-SHOW")!.id;
  oem = (await unsafeDb.vendor.findFirstOrThrow({ where: { brandId: HMNL(), type: "OEM" } })).id;
});

const unit = (id: string) => unsafeDb.vehicleUnit.findUniqueOrThrow({ where: { id } });
const n = (d: { toString(): string }) => Number(d.toString());

/** Receives `count` vehicles of the model at `cost` NGN each; returns the unit ids (status: PDI pending). */
async function receive(count: number, cost = 30_000_000, date?: string) {
  // logistics has cost access; a stock controller's prices would be replaced by the system's (see the cost-tier test)
  const grn = await inv.createInvDocument(logistics, "GRN", { brandId: HMNL(), vendorId: oem, warehouseId: yard, docDate: date, lines: Array.from({ length: count }, () => ({ productId: model.id, vin: vin(), unitCost: cost, data: { colour: "White" } })) });
  await inv.transition(stock, grn.id, "receive");
  const lines = await unsafeDb.inventoryDocumentLine.findMany({ where: { documentId: grn.id }, orderBy: { position: "asc" } });
  return { grnId: grn.id, number: grn.number, unitIds: lines.map((l) => l.vehicleUnitId!) };
}
async function passPdi(unitId: string) {
  const pdi = await inv.startPdi(stock, unitId);
  const doc = await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: pdi.id } });
  const items = ((doc.data as { checklist: Array<{ item: string }> }).checklist ?? []).map((c) => c.item);
  return inv.completePdi(stock, pdi.id, { results: Object.fromEntries(items.map((i) => [i, true])) });
}
async function availableUnit(cost = 30_000_000) {
  const { unitIds } = await receive(1, cost);
  await passPdi(unitIds[0]!);
  return unitIds[0]!;
}

describe("goods receipt", () => {
  it("creates units, ledger rows, balances and a balanced journal; numbers are per brand", async () => {
    const before = await unsafeDb.stockBalance.findUnique({ where: { brandId_productId_warehouseId_batchNo: { brandId: HMNL(), productId: model.id, warehouseId: yard, batchNo: "" } } });
    const { grnId, number, unitIds } = await receive(2, 30_000_000);
    expect(number).toMatch(/^HMNL-GRN-\d{4}-\d{5}$/);
    const units = await Promise.all(unitIds.map(unit));
    expect(units.every((u) => u.status === "PDI_PENDING" && u.warehouseId === yard && n(u.purchaseCost) === 30_000_000 && u.receivedAt)).toBe(true);
    const moves = await unsafeDb.stockMovement.findMany({ where: { sourceDocId: grnId } });
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.movementType === "RECEIPT" && n(m.qtyIn) === 1 && n(m.totalCost) === 30_000_000 && m.brandId === HMNL())).toBe(true);
    const after = await unsafeDb.stockBalance.findUniqueOrThrow({ where: { brandId_productId_warehouseId_batchNo: { brandId: HMNL(), productId: model.id, warehouseId: yard, batchNo: "" } } });
    expect(n(after.qty) - n(before?.qty ?? 0)).toBe(2);
    expect(n(after.value) - n(before?.value ?? 0)).toBe(60_000_000);
    const [journal] = await unsafeDb.journalEntry.findMany({ where: { sourceDocId: grnId }, include: { lines: true } });
    expect(journal!.number).toMatch(/^HMNL-JV-/);
    expect(journal!.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["1400 Inventory", 60_000_000, 0], ["2150 Goods received not invoiced", 0, 60_000_000]]);
    expect((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: grnId } })).status).toBe("RECEIVED");
    // history row and a second post is refused
    expect(await unsafeDb.vehicleStatusHistory.count({ where: { unitId: unitIds[0]! } })).toBe(1);
    await expect(inv.transition(stock, grnId, "receive")).rejects.toThrow(/cannot be/);
  });

  it("rejects a bad VIN, a VIN already in stock, and another brand's item or warehouse", async () => {
    const mk = (line: Record<string, unknown>, over: Record<string, unknown> = {}) => inv.createInvDocument(stock, "GRN", { brandId: HMNL(), warehouseId: yard, lines: [{ productId: model.id, unitCost: 1, ...line }], ...over });
    await expect(mk({ vin: "1M8GDM9A1KP042788" })).rejects.toThrow(/check digit/);
    const { unitIds } = await receive(1);
    const dup = await mk({ vin: (await unit(unitIds[0]!)).vin });
    await expect(inv.transition(stock, dup.id, "receive")).rejects.toThrow(/already in stock/);
    const snProduct = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    const snWarehouse = await unsafeDb.warehouse.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(mk({ productId: snProduct.id, vin: vin() })).rejects.toThrow(/does not belong to this brand/);
    await expect(mk({ vin: vin() }, { warehouseId: snWarehouse.id })).rejects.toThrow(/does not belong to this brand/);
    // an HMNL user cannot create documents for SNMNL at all
    await expect(inv.createInvDocument(stock, "GRN", { brandId: I.brand("SNMNL"), warehouseId: snWarehouse.id, lines: [] })).rejects.toBeInstanceOf(ForbiddenError);
    // the DB refuses a cross-brand unit even for the system client
    await expect(unsafeDb.vehicleUnit.create({ data: { brandId: HMNL(), productId: snProduct.id, vin: vin() } })).rejects.toThrow(/another brand/);
    await expect(unsafeDb.vehicleUnit.create({ data: { brandId: HMNL(), productId: model.id, vin: vin(), warehouseId: snWarehouse.id } })).rejects.toThrow(/another brand/);
  });

  it("the ledger is append-only and journals are immutable and balanced – for every role", async () => {
    const { grnId } = await receive(1);
    const move = await unsafeDb.stockMovement.findFirstOrThrow({ where: { sourceDocId: grnId } });
    await expect(unsafeDb.stockMovement.update({ where: { id: move.id }, data: { totalCost: 1 } })).rejects.toThrow(/append-only/);
    await expect(unsafeDb.stockMovement.delete({ where: { id: move.id } })).rejects.toThrow(/append-only/);
    await expect(rawAsUser(acct, `UPDATE "StockMovement" SET "totalCost" = 1 WHERE id = '${move.id}'`)).rejects.toThrow(/permission denied/);
    await expect(rawAsUser(acct, `INSERT INTO "StockBalance" ("brandId","productId","warehouseId","batchNo","qty","value") VALUES ('${HMNL()}','${model.id}','${yard}','x',99,0)`)).rejects.toThrow(/permission denied/);
    const journal = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: grnId }, include: { lines: true } });
    await expect(unsafeDb.journalEntry.update({ where: { id: journal.id }, data: { memo: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(unsafeDb.journalEntry.delete({ where: { id: journal.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(unsafeDb.journalLine.update({ where: { id: journal.lines[0]!.id }, data: { debit: 1 } })).rejects.toThrow(/append-only/);
    await expect(unsafeDb.journalEntry.create({ data: { brandId: HMNL(), date: new Date(), memo: "unbalanced", lines: { create: [{ account: "a", debit: 10 }, { account: "b", credit: 9 }] } } })).rejects.toThrow(/does not balance/);
  });
});

describe("procurement flow", () => {
  it("PO in USD → approval above the limit → shipment → clearing → receipt → bill → landed cost", async () => {
    await inv.saveSettings(acct, HMNL(), { reservationDays: 7, adjustmentApprovalLimit: 500_000, poApprovalLimit: 50_000_000, partsValuation: "WEIGHTED_AVERAGE", pdiTemplate: ["Exterior", "Road test"], accounts: {} });
    await expect(inv.saveSettings(stock, HMNL(), {})).rejects.toBeInstanceOf(ForbiddenError); // finance only
    const po = await inv.createInvDocument(logistics, "PO", { brandId: HMNL(), vendorId: oem, warehouseId: yard, currency: "USD", exchangeRate: 1500, lines: [{ productId: model.id, qty: 2, unitCost: 20_000 }] });
    expect(po.number).toMatch(/^HMNL-PO-/);
    // 60m NGN is above the 50m limit: the stock controller cannot issue it alone
    expect((await inv.transition(logistics, po.id, "submit")).status).toBe("PENDING_APPROVAL");
    await expect(inv.transition(logistics, po.id, "approve")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inv.transition(snBm, po.id, "approve")).rejects.toBeInstanceOf(NotFoundError); // another brand's manager does not even see it
    expect((await inv.transition(bm, po.id, "approve")).status).toBe("ISSUED");

    const [v1, v2] = [vin(), vin()];
    const shipment = await inv.createInvDocument(logistics, "SHIPMENT", { brandId: HMNL(), vendorId: oem, parentId: po.id, reference: "BL-TEST-1", data: { vessel: "MV Test" }, lines: [{ productId: model.id, vin: v1 }, { productId: model.id, vin: v2 }] });
    await inv.transition(logistics, shipment.id, "advance"); // shipped
    const inTransit = await unsafeDb.vehicleUnit.findMany({ where: { shipmentId: shipment.id } });
    expect(inTransit.map((u) => u.status)).toEqual(["IN_TRANSIT", "IN_TRANSIT"]);
    await inv.transition(logistics, shipment.id, "advance"); // at port
    await inv.transition(logistics, shipment.id, "advance"); // clearing
    expect((await unsafeDb.vehicleUnit.findMany({ where: { shipmentId: shipment.id } })).every((u) => u.status === "IN_CLEARING")).toBe(true);
    await inv.transition(logistics, shipment.id, "advance"); // cleared

    // the stock controller receives against the shipment: whatever price is sent, the purchase order's price counts
    const grn = await inv.createInvDocument(stock, "GRN", { brandId: HMNL(), vendorId: oem, warehouseId: yard, parentId: shipment.id, currency: "USD", exchangeRate: 3, lines: [{ productId: model.id, vin: v1, unitCost: 1 }, { productId: model.id, vin: v2, unitCost: 999_999_999 }] });
    await inv.transition(stock, grn.id, "receive");
    const received = await unsafeDb.vehicleUnit.findMany({ where: { shipmentId: shipment.id }, orderBy: { vin: "asc" } });
    expect(received.every((u) => u.status === "PDI_PENDING" && n(u.purchaseCost) === 30_000_000)).toBe(true);
    expect((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");

    // bill: finance only; a higher invoice books purchase price variance
    await expect(inv.createInvDocument(stock, "BILL", { brandId: HMNL(), vendorId: oem, lines: [{ description: "x", unitCost: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    const bill = await inv.createInvDocument(acct, "BILL", { brandId: HMNL(), vendorId: oem, parentId: grn.id, currency: "USD", exchangeRate: 1500, reference: "INV-OEM-1", lines: [{ description: "2 vehicles", unitCost: 40_100 }] });
    expect((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: grn.id } })).currency).toBe("NGN"); // the receipt of a user without cost access is in NGN at the order's price
    await inv.transition(acct, bill.id, "open");
    const bj = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: bill.id }, include: { lines: true } });
    expect(bj.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["2150 Goods received not invoiced", 60_000_000, 0], ["5910 Purchase price variance", 150_000, 0], ["2100 Accounts payable", 0, 60_150_000]]);
    expect((await inv.transition(acct, bill.id, "pay", { amount: 10_000 })).status).toBe("PARTIALLY_PAID");
    await expect(inv.transition(acct, bill.id, "pay", { amount: 999_999 })).rejects.toThrow(/open balance/);
    expect((await inv.transition(acct, bill.id, "pay", { amount: 30_100 })).status).toBe("PAID");

    // landed cost: logistics enters it, finance allocates; unit cost goes up
    const lc = await inv.createInvDocument(logistics, "LANDED_COST", { brandId: HMNL(), parentId: shipment.id, data: { method: "QUANTITY", unitIds: received.map((u) => u.id) }, lines: [{ description: "Customs duty", unitCost: 5_000_000 }, { description: "Clearing agent", unitCost: 500_001 }] });
    await expect(inv.transition(logistics, lc.id, "allocate")).rejects.toBeInstanceOf(ForbiddenError);
    await inv.transition(acct, lc.id, "allocate");
    const costed = await unsafeDb.vehicleUnit.findMany({ where: { shipmentId: shipment.id }, orderBy: { vin: "asc" } });
    expect(costed.map((u) => n(u.landedCost)).sort()).toEqual([2_750_000.5, 2_750_000.5]);
    const lj = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: lc.id }, include: { lines: true } });
    expect(lj.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["1400 Inventory", 5_500_001, 0], ["2160 Landed cost clearing", 0, 5_500_001]]);
    // the balance carries the landed cost as value without changing the quantity
    const view = await q.getUnit(acct, costed[0]!.id);
    expect(view.totalCost).toBe(n(costed[0]!.purchaseCost) + n(costed[0]!.landedCost));
    expect(view.movements.map((m) => m.movementType)).toEqual(expect.arrayContaining(["RECEIPT", "LANDED_COST"]));
    await inv.saveSettings(acct, HMNL(), { reservationDays: 7, adjustmentApprovalLimit: 500_000, poApprovalLimit: 100_000_000, partsValuation: "WEIGHTED_AVERAGE", pdiTemplate: ["Exterior", "Road test"], accounts: {} });
  });
});

describe("PDI, reservation and sale", () => {
  it("a unit is not available until PDI passes; a failed PDI puts it on hold", async () => {
    const { unitIds } = await receive(2);
    const [a, b] = unitIds as [string, string];
    const deal = await createDeal(exec, { name: "PDI deal", brandId: HMNL(), regionId: I.region("Lagos") } as never);
    await expect(reserveVin(exec, deal.id, a)).rejects.toThrow(/not available/);
    expect((await passPdi(a)).passed).toBe(true);
    expect(await unit(a)).toMatchObject({ status: "AVAILABLE" });
    expect((await unit(a)).pdiPassedAt).not.toBeNull();
    const pdi = await inv.startPdi(stock, b);
    expect((await inv.completePdi(stock, pdi.id, { results: { Exterior: true, "Road test": false }, notes: "Pulls to the left" })).passed).toBe(false);
    expect(await unit(b)).toMatchObject({ status: "ON_HOLD", damageNotes: "Pulls to the left" });
    await expect(inv.startPdi(exec, a)).rejects.toBeInstanceOf(ForbiddenError); // sales users do not run PDI
  });

  it("reservation race: two executives, one unit – exactly one wins", async () => {
    const id = await availableUnit();
    const [d1, d2] = await Promise.all([createDeal(exec, { name: "Race 1", brandId: HMNL(), regionId: I.region("Lagos") } as never), createDeal(exec2, { name: "Race 2", brandId: HMNL(), regionId: I.region("Lagos") } as never)]);
    const results = await Promise.allSettled([reserveVin(exec, d1.id, id), reserveVin(exec2, d2.id, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason.message)).toMatch(/reserved by someone else|not available/);
    const u = await unit(id);
    expect(u.status).toBe("RESERVED");
    expect([d1.id, d2.id]).toContain(u.dealId);
    expect(u.reservedUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(await unsafeDb.vehicleStatusHistory.count({ where: { unitId: id, to: "RESERVED" } })).toBe(1);
  });

  it("reservations expire; the Brand Manager can extend one", async () => {
    const id = await availableUnit();
    const deal = await createDeal(exec, { name: "Expiry deal", brandId: HMNL(), regionId: I.region("Lagos") } as never);
    await reserveVin(exec, deal.id, id);
    await expect(inv.extendReservation(exec, id, 5)).rejects.toBeInstanceOf(ForbiddenError);
    const { until } = await inv.extendReservation(bm, id, 5);
    expect(until.getTime()).toBeGreaterThan(Date.now() + 11 * 86_400_000);
    expect(await inv.expireReservations(new Date(Date.now() + 5 * 86_400_000))).toBe(0);
    expect(await inv.expireReservations(new Date(until.getTime() + 1000))).toBeGreaterThanOrEqual(1);
    expect(await unit(id)).toMatchObject({ status: "AVAILABLE", dealId: null, reservedUntil: null });
    expect((await getDeal(exec, deal.id)).vinChassisNo).toBeNull();
  });

  it("a sales order can only take a unit of its own brand; invoice posts cost of sale; gate pass delivers", async () => {
    const id = await availableUnit(30_000_000);
    const u0 = await unit(id);
    const deal = await createDeal(exec, { name: "Sale deal", brandId: HMNL(), regionId: I.region("Lagos"), modelId: model.id } as never);
    // another brand's unit cannot be reserved for the deal, and the DB refuses to attach it to an HMNL order
    const foreign = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: I.brand("SNMNL"), status: "AVAILABLE" } });
    await expect(reserveVin(exec, deal.id, foreign.id)).rejects.toThrow(/record's brand/);
    await reserveVin(exec, deal.id, id);
    const quote = await docs.createQuoteFromDeal(exec, deal.id);
    await docs.submitQuote(exec, quote.id);
    await docs.acceptQuote(exec, quote.id);
    const order = await docs.convertQuoteToOrder(exec, quote.id);
    await docs.confirmOrder(exec, order.id);
    await expect(unsafeDb.vehicleUnit.update({ where: { id: foreign.id }, data: { salesOrderId: order.id } })).rejects.toThrow(/sales order belongs to another brand/);
    await expect(unsafeDb.vehicleUnit.update({ where: { id: foreign.id }, data: { dealId: deal.id } })).rejects.toThrow(/deal belongs to another brand/);
    await docs.allocateOrder(exec, order.id);
    expect(await unit(id)).toMatchObject({ status: "ALLOCATED", salesOrderId: order.id });

    const invoice = await docs.convertOrderToInvoice(exec, order.id);
    await docs.issueInvoice(exec, invoice.id);
    expect(await unit(id)).toMatchObject({ status: "INVOICED", invoiceId: invoice.id });
    const issue = await unsafeDb.stockMovement.findFirstOrThrow({ where: { vehicleUnitId: id, movementType: "SALE_ISSUE" } });
    expect([n(issue.qtyOut), n(issue.totalCost)]).toEqual([1, n(u0.purchaseCost) + n(u0.landedCost)]);
    const cogs = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: invoice.id }, include: { lines: true } });
    expect(cogs.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["5000 Cost of goods sold", 30_000_000, 0], ["1400 Inventory", 0, 30_000_000]]);

    await docs.deliverOrder(exec, order.id);
    const delivered = await unit(id);
    expect(delivered).toMatchObject({ status: "DELIVERED", warehouseId: null });
    expect(delivered.deliveredAt).not.toBeNull();
    expect(await unsafeDb.stockMovement.count({ where: { vehicleUnitId: id, movementType: "SALE_ISSUE" } })).toBe(1); // issued once
    const note = await unsafeDb.inventoryDocument.findFirstOrThrow({ where: { type: "DELIVERY_NOTE", lines: { some: { vehicleUnitId: id } } } });
    expect(note.number).toMatch(/^HMNL-DN-/);
    expect((await getDeal(exec, deal.id)).stage).toBe("DELIVERY");
    expect((await unsafeDb.vehicleStatusHistory.findMany({ where: { unitId: id }, orderBy: { at: "asc" } })).map((h) => h.to)).toEqual(["PDI_PENDING", "AVAILABLE", "RESERVED", "ALLOCATED", "INVOICED", "DELIVERED"]);
    // gross margin report: finance only
    const margin = await runInvReport(acct, "margin");
    expect(margin.rows.some((r) => r[1] === delivered.vin && r[5] === 30_000_000)).toBe(true);
    await expect(runInvReport(stock, "margin")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("adjustments, period lock, transfers, counts, parts", () => {
  it("a write-off above the limit needs the Brand Accountant; below it posts directly", async () => {
    const { unitIds } = await receive(1, 30_000_000);
    const adj = await inv.createInvDocument(stock, "ADJUSTMENT", { brandId: HMNL(), reference: "Damage", notes: "Flood damage", lines: [{ vehicleUnitId: unitIds[0], data: { action: "WRITE_OFF" } }] });
    expect((await inv.transition(stock, adj.id, "post")).status).toBe("PENDING_APPROVAL");
    expect((await unit(unitIds[0]!)).status).toBe("PDI_PENDING"); // nothing posted yet
    await expect(inv.transition(stock, adj.id, "approve")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inv.transition(snAcct, adj.id, "approve")).rejects.toBeInstanceOf(NotFoundError);
    expect((await inv.transition(acct, adj.id, "approve")).status).toBe("ADJUSTED");
    expect(await unit(unitIds[0]!)).toMatchObject({ status: "WRITTEN_OFF" });
    const j = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: adj.id }, include: { lines: true } });
    expect(j.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["5900 Inventory adjustment", 30_000_000, 0], ["1400 Inventory", 0, 30_000_000]]);
    // a small parts adjustment is within the limit
    const small = await inv.createInvDocument(stock, "ADJUSTMENT", { brandId: HMNL(), warehouseId: yard, reference: "Count variance", lines: [{ productId: part.id, qty: -1 }] });
    expect((await inv.transition(stock, small.id, "post")).status).toBe("ADJUSTED");
  });

  it("the period lock blocks back-dated postings", async () => {
    const lock = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await inv.saveSettings(acct, HMNL(), { reservationDays: 7, adjustmentApprovalLimit: 500_000, poApprovalLimit: 100_000_000, lockDate: lock, partsValuation: "WEIGHTED_AVERAGE", pdiTemplate: ["Exterior", "Road test"], accounts: {} });
    const backdated = await inv.createInvDocument(stock, "GRN", { brandId: HMNL(), warehouseId: yard, docDate: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId: model.id, vin: vin(), unitCost: 1_000_000 }] });
    await expect(inv.transition(stock, backdated.id, "receive")).rejects.toThrow(/is closed for this brand/);
    expect(await unsafeDb.stockMovement.count({ where: { sourceDocId: backdated.id } })).toBe(0); // the whole posting rolled back
    expect((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: backdated.id } })).status).toBe("DRAFT");
    await inv.updateInvDocument(stock, backdated.id, { warehouseId: yard, docDate: new Date().toISOString().slice(0, 10), lines: [{ productId: model.id, vin: vin(), unitCost: 1_000_000 }] });
    expect((await inv.transition(stock, backdated.id, "receive")).status).toBe("RECEIVED");
    // SNMNL has its own books: its lock date is untouched
    expect((await q.getSettings(snAcct, I.brand("SNMNL"))).lockDate).toBeNull();
    await inv.saveSettings(acct, HMNL(), { reservationDays: 7, adjustmentApprovalLimit: 500_000, poApprovalLimit: 100_000_000, partsValuation: "WEIGHTED_AVERAGE", pdiTemplate: ["Exterior", "Road test"], accounts: {} });
  });

  it("transfer between warehouses of the brand: in transit, then received at the same cost", async () => {
    const id = await availableUnit(25_000_000);
    const snWarehouse = await unsafeDb.warehouse.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(inv.createInvDocument(stock, "TRANSFER", { brandId: HMNL(), warehouseId: yard, toWarehouseId: snWarehouse.id, lines: [{ vehicleUnitId: id }] })).rejects.toThrow(/does not belong to this brand/);
    const to = await inv.createInvDocument(stock, "TRANSFER", { brandId: HMNL(), warehouseId: yard, toWarehouseId: showroom, lines: [{ vehicleUnitId: id }, { productId: part.id, qty: 2 }] });
    await inv.transition(stock, to.id, "ship");
    expect((await unit(id)).warehouseId).toBeNull();
    await inv.transition(stock, to.id, "receive");
    expect(await unit(id)).toMatchObject({ warehouseId: showroom, status: "AVAILABLE" });
    const moves = await unsafeDb.stockMovement.findMany({ where: { sourceDocId: to.id, vehicleUnitId: id }, orderBy: { movementType: "asc" } });
    expect(moves.map((m) => [m.movementType, m.warehouseId, n(m.totalCost)])).toEqual([["TRANSFER_IN", showroom, 25_000_000], ["TRANSFER_OUT", yard, 25_000_000]]);
    const partBalance = await unsafeDb.stockBalance.findUniqueOrThrow({ where: { brandId_productId_warehouseId_batchNo: { brandId: HMNL(), productId: part.id, warehouseId: showroom, batchNo: "" } } });
    expect(n(partBalance.qty)).toBe(2);
  });

  it("stock count: a vehicle that is not found becomes a draft write-off for review", async () => {
    const { unitIds } = await receive(2);
    const count = await inv.createInvDocument(stock, "STOCK_COUNT", { brandId: HMNL(), warehouseId: yard, reference: "Cycle count" });
    await inv.transition(stock, count.id, "start");
    const lines = await unsafeDb.inventoryDocumentLine.findMany({ where: { documentId: count.id } });
    const expected = lines.filter((l) => l.vehicleUnitId).map((l) => l.vin!);
    const missing = (await unit(unitIds[0]!)).vin;
    const res = await inv.recordCount(stock, count.id, { vins: [...expected.filter((v) => v !== missing), "11111111111111111"] });
    expect(res.matched).toBe(expected.length - 1);
    expect(res.unexpected).toEqual(["11111111111111111"]);
    const out = (await inv.transition(stock, count.id, "reconcile")) as { status: string; adjustmentId: string | null };
    expect(out.status).toBe("RECONCILED");
    const adj = await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: out.adjustmentId! }, include: { lines: true } });
    expect(adj).toMatchObject({ type: "ADJUSTMENT", status: "DRAFT" });
    expect(adj.lines.map((l) => l.vin)).toEqual([missing]);
    expect((await unit(unitIds[0]!)).status).toBe("PDI_PENDING"); // nothing is written off without a posted, approved adjustment
  });

  it("parts: weighted-average issue and reorder alerts", async () => {
    const p = await unsafeDb.product.create({ data: { brandId: HMNL(), code: `HMNL-ZT-${Date.now()}`, name: "Test filter", category: "PART", trackingType: "NONE", valuationMethod: "WEIGHTED_AVERAGE", reorderLevel: 5, reorderQty: 20 } });
    for (const [qty, cost] of [[10, 100], [10, 120]] as const) {
      const grn = await inv.createInvDocument(logistics, "GRN", { brandId: HMNL(), warehouseId: yard, lines: [{ productId: p.id, qty, unitCost: cost }] });
      await inv.transition(stock, grn.id, "receive");
    }
    const adj = await inv.createInvDocument(stock, "ADJUSTMENT", { brandId: HMNL(), warehouseId: yard, reference: "Damage", lines: [{ productId: p.id, qty: -16 }] });
    await inv.transition(stock, adj.id, "post");
    const balance = await unsafeDb.stockBalance.findUniqueOrThrow({ where: { brandId_productId_warehouseId_batchNo: { brandId: HMNL(), productId: p.id, warehouseId: yard, batchNo: "" } } });
    expect([n(balance.qty), n(balance.value)]).toEqual([4, 440]); // 2,200 − 16 × 110
    const over = await inv.createInvDocument(stock, "ADJUSTMENT", { brandId: HMNL(), warehouseId: yard, reference: "Damage", lines: [{ productId: p.id, qty: -5 }] });
    await expect(inv.transition(stock, over.id, "post")).rejects.toThrow(/Only 4 in stock/);
    const reorder = await q.listStockBalances(stock, { brandId: HMNL(), reorderOnly: true });
    expect(reorder.find((r) => r.productId === p.id)).toMatchObject({ qty: 4, belowReorder: true, reorderQty: 20 });
    expect(reorder[0]).not.toHaveProperty("value"); // stock controllers see quantities, not value
    expect((await q.listStockBalances(acct, { brandId: HMNL(), reorderOnly: true })).find((r) => r.productId === p.id)!.value).toBe(440);
  });
});

describe("brand isolation and cost tier", () => {
  it("HMNL users never see SNMNL warehouses, units, vendors, documents or journals – lists, ids, scanner, SQL", async () => {
    const sn = I.brand("SNMNL");
    const snUnit = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: sn, status: "AVAILABLE" } });
    const snDoc = await unsafeDb.inventoryDocument.findFirstOrThrow({ where: { brandId: sn } });
    const snJournal = await unsafeDb.journalEntry.findFirstOrThrow({ where: { brandId: sn } });
    for (const ctx of [stock, acct, bm, exec]) {
      expect((await q.listUnits(ctx, {}, { take: 500 })).rows.every((u) => u.brandId === HMNL())).toBe(true);
      expect((await q.listWarehouses(ctx)).every((w) => w.brandId === HMNL())).toBe(true);
      await expect(q.getUnit(ctx, snUnit.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(q.lookupVin(ctx, snUnit.vin)).rejects.toBeInstanceOf(NotFoundError); // scanning an SNMNL VIN: "not found"
      expect((await q.listUnits(ctx, { brandId: sn }, { take: 500 })).rows).toEqual([]);
      for (const table of ["Warehouse", "Vendor", "VehicleUnit", "StockMovement", "StockBalance", "InventoryDocument", "JournalEntry", "InventorySettings", "VehicleStatusHistory"]) {
        expect(await rawAsUser(ctx, `SELECT 1 FROM "${table}" WHERE "brandId" = '${sn}' LIMIT 1`), `${table} via RLS`).toEqual([]);
      }
      expect(await rawAsUser(ctx, `SELECT 1 FROM "InventoryDocumentLine" WHERE "documentId" = '${snDoc.id}' LIMIT 1`)).toEqual([]);
      expect(await rawAsUser(ctx, `SELECT 1 FROM "JournalLine" WHERE "entryId" = '${snJournal.id}' LIMIT 1`)).toEqual([]);
    }
    for (const ctx of [stock, acct, bm]) {
      expect((await q.listVendors(ctx)).every((v) => v.brandId === HMNL())).toBe(true);
      expect((await q.listInvDocuments(ctx, "SHIPMENT", {}, { take: 200 })).rows.every((d) => d.brandId === HMNL())).toBe(true);
      await expect(q.getInvDocument(ctx, snDoc.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await runInvReport(ctx, "stock-on-hand")).rows.every((r) => r[0] === "HMNL")).toBe(true);
      expect((await runInvReport(ctx, "movements", { vin: snUnit.vin })).rows).toEqual([]);
      await expect(runInvReport(ctx, "consolidated")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await q.listJournals(acct, {}, { take: 200 })).rows.every((j) => j.brandId === HMNL())).toBe(true);
    await expect(q.getJournal(acct, snJournal.id)).rejects.toBeInstanceOf(NotFoundError);
    // group management sees the consolidation; SNMNL staff see their own brand
    const group = await runInvReport(md, "consolidated");
    expect(group.rows.map((r) => r[0])).toEqual(expect.arrayContaining(["HMNL", "SNMNL"]));
    expect((await q.getUnit(snStock, snUnit.id)).id).toBe(snUnit.id);
    void [snExec, admin];
  });

  it("sales executives see only what they can sell – no cost, VIN masked until the unit is theirs", async () => {
    const id = await availableUnit(30_000_000);
    const { unitIds } = await receive(1); // PDI pending: not for sale
    expect(q.isSalesView(exec)).toBe(true);
    const list = await q.listUnits(exec, {}, { take: 500 });
    expect(list.salesView).toBe(true);
    expect(list.rows.length).toBeGreaterThan(0);
    const row = list.rows.find((r) => r.id === id)!;
    expect(row.vin).toMatch(/^•{11}[A-Z0-9]{6}$/);
    for (const r of list.rows) {
      expect(r).not.toHaveProperty("purchaseCost");
      expect(r).not.toHaveProperty("landedCost");
      expect(r).not.toHaveProperty("totalCost");
      expect(r.status === "AVAILABLE" || r.dealId !== null).toBe(true);
    }
    expect(list.rows.find((r) => r.id === unitIds[0])).toBeUndefined();
    await expect(q.getUnit(exec, unitIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    const detail = await q.getUnit(exec, id);
    expect(detail).not.toHaveProperty("totalCost");
    expect([detail.history, detail.movements, detail.keyNo, detail.customsDocNo]).toEqual([[], [], null, null]);
    // no documents, vendors, parts, journals or reports for sales users
    await expect(q.listInvDocuments(exec, "GRN")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(q.listVendors(exec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(q.listStockBalances(exec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(q.listJournals(exec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runInvReport(exec, "ageing")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inv.createInvDocument(exec, "GRN", { brandId: HMNL(), warehouseId: yard, lines: [] })).rejects.toBeInstanceOf(ForbiddenError);
    // once reserved for their own deal the VIN is shown in full; a colleague still sees nothing of it
    const deal = await createDeal(exec, { name: "Mask deal", brandId: HMNL(), regionId: I.region("Lagos") } as never);
    await reserveVin(exec, deal.id, id);
    expect((await q.getUnit(exec, id)).vin).toBe((await unit(id)).vin);
    expect((await q.listUnits(exec, { view: "mine" }, { take: 50 })).rows.map((r) => r.id)).toContain(id);
    // the stock controller sees the unit and its history, but still no cost; finance and the Brand Manager do
    const controller = await q.getUnit(stock, id);
    expect(controller.history.length).toBeGreaterThan(0);
    expect(controller).not.toHaveProperty("totalCost");
    expect(controller.movements[0]).not.toHaveProperty("totalCost");
    expect((await q.getUnit(acct, id)).totalCost).toBe(30_000_000);
    expect((await q.getUnit(bm, id)).totalCost).toBe(30_000_000);
    const grn = await q.listInvDocuments(stock, "GRN", {}, { take: 5 });
    expect(grn.rows[0]).not.toHaveProperty("total");
    const doc = await q.getInvDocument(stock, grn.rows[0]!.id);
    expect(doc.lines[0]).not.toHaveProperty("unitCost");
    expect(doc.journals).toEqual([]);
    await expect(q.listInvDocuments(stock, "BILL")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("inter-brand transfer", () => {
  it("needs the manager and the accountant of both brands; the buyer gets a new unit at the transfer price", async () => {
    const id = await availableUnit(30_000_000);
    const source = await unit(id);
    const sn = I.brand("SNMNL");
    await expect(inv.createInvDocument(stock, "INTER_BRAND", { brandId: HMNL(), toBrandId: sn, lines: [{ vehicleUnitId: id, unitCost: 31_000_000 }] })).rejects.toThrow(/need inventory finance access/); // a price is a cost
    const doc = await inv.createInvDocument(bm, "INTER_BRAND", { brandId: HMNL(), toBrandId: sn, lines: [{ vehicleUnitId: id, unitCost: 31_000_000 }] });
    expect(doc.number).toMatch(/^HMNL-IBT-/);
    await inv.transition(stock, doc.id, "submit");
    await expect(inv.transition(stock, doc.id, "ship")).rejects.toThrow(/cannot be/);
    // SNMNL sees the incoming transfer (units and price) but not the document row or the seller's cost
    const incoming = (await q.incomingTransfers(snAcct)).find((t) => t.id === doc.id)!;
    expect(incoming.lines).toEqual([expect.objectContaining({ vin: source.vin, price: 31_000_000 })]);
    expect(JSON.stringify(incoming)).not.toContain("30000000");
    await expect(q.getInvDocument(snAcct, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await q.incomingTransfers(snStock)).find((t) => t.id === doc.id)!.lines[0]!.price).toBeNull(); // no cost tier
    // approvals: each role fills only its own slot on its own side
    await expect(inv.approveInterBrand(stock, doc.id, "from")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inv.approveInterBrand(bm, doc.id, "to")).rejects.toBeInstanceOf(NotFoundError);
    expect((await inv.transition(bm, doc.id, "approve")).status).toBe("PENDING_APPROVAL");
    await inv.approveInterBrand(acct, doc.id, "from");
    await inv.approveInterBrand(snBm, doc.id, "to");
    const last = await inv.approveInterBrand(snAcct, doc.id, "to");
    expect(last.status).toBe("APPROVED");
    const approvals = ((await unsafeDb.inventoryDocument.findUniqueOrThrow({ where: { id: doc.id } })).data as { approvals: Record<string, { name: string }> }).approvals;
    expect(Object.keys(approvals).sort()).toEqual(["fromFinance", "fromManager", "toFinance", "toManager"]);

    await inv.transition(stock, doc.id, "ship");
    expect(await unit(id)).toMatchObject({ status: "TRANSFERRED", brandId: HMNL() });
    const out = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: doc.id, brandId: HMNL() }, include: { lines: true } });
    expect(out.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["1900 Inter-company", 31_000_000, 0], ["1400 Inventory", 0, 30_000_000], ["5900 Inventory adjustment", 0, 1_000_000]]);

    const snWarehouse = await unsafeDb.warehouse.findFirstOrThrow({ where: { brandId: sn, code: "LAG-YARD" } });
    const snModel = await unsafeDb.product.findFirstOrThrow({ where: { brandId: sn, category: "VEHICLE" } });
    await expect(inv.receiveInterBrand(stock, doc.id, { toWarehouseId: snWarehouse.id, lineProducts: { [incoming.lines[0]!.id]: snModel.id } })).rejects.toBeInstanceOf(NotFoundError); // the seller cannot receive for the buyer
    await expect(inv.receiveInterBrand(snStock, doc.id, { toWarehouseId: yard, lineProducts: { [incoming.lines[0]!.id]: snModel.id } })).rejects.toThrow(/warehouse of the receiving brand/);
    await inv.receiveInterBrand(snStock, doc.id, { toWarehouseId: snWarehouse.id, lineProducts: { [incoming.lines[0]!.id]: snModel.id } });
    const bought = await unsafeDb.vehicleUnit.findUniqueOrThrow({ where: { brandId_vin: { brandId: sn, vin: source.vin } } });
    expect(bought).toMatchObject({ status: "PDI_PENDING", productId: snModel.id, warehouseId: snWarehouse.id });
    expect([n(bought.purchaseCost), n(bought.landedCost)]).toEqual([31_000_000, 0]); // the transfer price, not the seller's cost history
    const inJ = await unsafeDb.journalEntry.findFirstOrThrow({ where: { sourceDocId: doc.id, brandId: sn }, include: { lines: true } });
    expect(inJ.lines.map((l) => [l.account, n(l.debit), n(l.credit)])).toEqual([["1400 Inventory", 31_000_000, 0], ["1900 Inter-company", 0, 31_000_000]]);
    // each side sees only its own unit and its own journal
    await expect(q.getUnit(snAcct, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(q.getUnit(acct, bought.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(q.getJournal(acct, inJ.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
