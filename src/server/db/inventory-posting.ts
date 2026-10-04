/**
 * Inventory posting engine (prompt 16). A posting touches several tables that must change together – the
 * append-only stock ledger, the balances, the vehicle units with their status history, the journal and the
 * document status – so it runs in ONE database transaction with the system client. The services in
 * src/server/modules/inventory check WHO may post (brand access + permission) before they call in here; every
 * function takes the brand it acts for and refuses rows of another brand, and DB triggers refuse cross-brand
 * references, a changed ledger row and an unbalanced journal.
 */
import "server-only";
import { Prisma, type InventoryDocument, type InventoryDocumentLine, type VehicleUnit } from "@prisma/client";
import { BadRequestError } from "@/server/errors";
import { allocateLandedCost, round2, weightedAverageIssue, fifoIssue, fifoLayers, type AllocationMethod } from "@/server/modules/inventory/costing";
import { accountMap, adjustmentJournal, billJournal, interBrandInJournal, interBrandOutJournal, landedCostJournal, receiptJournal, returnJournal, saleIssueJournal, type JournalDraft } from "@/server/modules/inventory/journal";
import { assertTransition, type VehicleStatus } from "@/server/modules/inventory/status";
import { normalizeVin, vinProblem } from "@/server/modules/inventory/vin";
import { unsafeDb } from "./unsafe";

type Tx = Prisma.TransactionClient;
export interface Actor {
  userId: string | null;
}
type Doc = InventoryDocument & { lines: InventoryDocumentLine[] };

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
const json = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const tx = <T>(fn: (t: Tx) => Promise<T>) => unsafeDb.$transaction(fn, { timeout: 30_000 });

// ───────────────────────────── primitives (inside a transaction) ─────────────────────────────

export async function settingsFor(t: Tx | typeof unsafeDb, brandId: string) {
  return t.inventorySettings.upsert({ where: { brandId }, create: { brandId }, update: {} });
}

/** Period close: nothing may be posted on or before the brand's lock date. */
async function openPeriod(t: Tx, brandId: string, date: Date) {
  const s = await settingsFor(t, brandId);
  if (s.lockDate && date.getTime() <= s.lockDate.getTime() + 86_399_999) {
    throw new BadRequestError(`The period up to ${s.lockDate.toISOString().slice(0, 10)} is closed for this brand – use a later date`);
  }
  return s;
}

async function loadDoc(t: Tx, id: string, brandId: string, type: string, statuses: string[]): Promise<Doc> {
  // row lock: two users posting the same document cannot both pass the status check
  await t.$queryRaw`SELECT id FROM "InventoryDocument" WHERE id = ${id} FOR UPDATE`;
  const doc = await t.inventoryDocument.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!doc || doc.brandId !== brandId || doc.type !== type) throw new BadRequestError("Document not found");
  if (!statuses.includes(doc.status)) throw new BadRequestError(`This document is ${doc.status.toLowerCase().replace(/_/g, " ")} – it cannot be posted again`);
  return doc;
}

interface Move {
  brandId: string;
  productId: string;
  vehicleUnitId?: string | null;
  warehouseId: string;
  batchNo?: string | null;
  qtyIn?: number;
  qtyOut?: number;
  /** total value of the movement in NGN (positive) */
  totalCost: number;
  movementType: string;
  doc: { type: string; id: string };
  at: Date;
  userId: string | null;
}

/** Appends a ledger row and updates the balance in the same transaction. */
async function move(t: Tx, m: Move) {
  const qtyIn = m.qtyIn ?? 0;
  const qtyOut = m.qtyOut ?? 0;
  const qty = qtyIn || qtyOut;
  const batchNo = m.batchNo ?? "";
  const sign = m.movementType === "LANDED_COST" || qtyIn > 0 ? 1 : -1;
  const key = { brandId: m.brandId, productId: m.productId, warehouseId: m.warehouseId, batchNo };
  const balance = await t.stockBalance.upsert({
    where: { brandId_productId_warehouseId_batchNo: key },
    create: { ...key, qty: qtyIn - qtyOut, value: sign * m.totalCost },
    update: { qty: { increment: qtyIn - qtyOut }, value: { increment: sign * m.totalCost } },
  });
  if (num(balance.qty) < -1e-9) throw new BadRequestError("There is not enough stock in this warehouse");
  await t.stockMovement.create({
    data: { brandId: m.brandId, productId: m.productId, vehicleUnitId: m.vehicleUnitId ?? null, warehouseId: m.warehouseId, batchNo, qtyIn, qtyOut, unitCost: qty ? round2(m.totalCost / qty) : 0, totalCost: round2(m.totalCost), movementType: m.movementType, sourceDocType: m.doc.type, sourceDocId: m.doc.id, at: m.at, userId: m.userId },
  });
}

async function journal(t: Tx, brandId: string, date: Date, draft: JournalDraft | null, doc: { type: string; id: string }): Promise<string | null> {
  if (!draft) return null;
  const entry = await t.journalEntry.create({ data: { brandId, date, memo: draft.memo, sourceDocType: doc.type, sourceDocId: doc.id, lines: { create: draft.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, memo: l.memo ?? null })) } }, select: { id: true } });
  return entry.id;
}

async function setStatus(t: Tx, unit: Pick<VehicleUnit, "id" | "brandId" | "status">, to: VehicleStatus, actor: Actor, note: string | null, patch: Prisma.VehicleUnitUncheckedUpdateInput = {}) {
  if (unit.status !== to) {
    try {
      assertTransition(unit.status as VehicleStatus, to);
    } catch (e) {
      throw new BadRequestError(e instanceof Error ? e.message : "Invalid status change");
    }
    await t.vehicleStatusHistory.create({ data: { brandId: unit.brandId, unitId: unit.id, from: unit.status, to, note, userId: actor.userId } });
  }
  await t.vehicleUnit.update({ where: { id: unit.id }, data: { ...patch, status: to } });
}

const unitCost = (u: Pick<VehicleUnit, "purchaseCost" | "landedCost">) => round2(num(u.purchaseCost) + num(u.landedCost));

/** Cost of issuing a quantity-tracked item from a warehouse (weighted average or FIFO, per the brand's setting). */
async function issueCost(t: Tx, brandId: string, productId: string, warehouseId: string, batchNo: string, qty: number, method: string): Promise<number> {
  const balance = await t.stockBalance.findUnique({ where: { brandId_productId_warehouseId_batchNo: { brandId, productId, warehouseId, batchNo } } });
  const onHand = { qty: num(balance?.qty), value: num(balance?.value) };
  try {
    if (method !== "FIFO") return weightedAverageIssue(onHand, qty);
    const rows = await t.stockMovement.findMany({ where: { brandId, productId, warehouseId, batchNo, movementType: { not: "LANDED_COST" } }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { qtyIn: true, qtyOut: true, unitCost: true } });
    return fifoIssue(fifoLayers(rows.map((r) => ({ qtyIn: num(r.qtyIn), qtyOut: num(r.qtyOut), unitCost: num(r.unitCost) }))), qty).cost;
  } catch (e) {
    throw new BadRequestError(e instanceof Error ? e.message : "Not enough stock");
  }
}

export interface Posted {
  documentId: string;
  status: string;
  journalIds: string[];
  /** units whose status changed: for events */
  units: Array<{ id: string; status: string }>;
}
const posted = (documentId: string, status: string, journalIds: Array<string | null>, units: Posted["units"] = []): Posted => ({ documentId, status, journalIds: journalIds.filter((j): j is string => !!j), units });

// ───────────────────────────── receipt (GRN) ─────────────────────────────

/** Goods received: vehicles by VIN (one unit each), parts by quantity. Dr Inventory / Cr GRNI. */
export function postReceipt(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "GRN", ["DRAFT"]);
    if (!doc.warehouseId) throw new BadRequestError("Choose the warehouse the goods are received into");
    if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
    await openPeriod(t, brandId, doc.docDate);
    const rate = num(doc.exchangeRate);
    const ref = { type: "GRN", id: doc.id };
    const changed: Posted["units"] = [];
    let total = 0;
    const seen = new Set<string>();
    for (const line of doc.lines) {
      if (!line.productId) throw new BadRequestError(`Line ${line.position}: choose the item`);
      const product = await t.product.findUnique({ where: { id: line.productId }, select: { brandId: true, trackingType: true, modelYear: true, name: true } });
      if (!product || product.brandId !== brandId) throw new BadRequestError(`Line ${line.position}: the item belongs to another brand`);
      const cost = round2(num(line.unitCost) * rate);
      if (product.trackingType === "SERIAL") {
        const vin = normalizeVin(line.vin ?? "");
        const problem = vinProblem(vin);
        if (problem) throw new BadRequestError(`Line ${line.position} (${vin || "no VIN"}): ${problem}`);
        if (seen.has(vin)) throw new BadRequestError(`VIN ${vin} is on this receipt twice`);
        seen.add(vin);
        const data = json(line.data);
        const existing = await t.vehicleUnit.findUnique({ where: { brandId_vin: { brandId, vin } } });
        if (existing && !["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING"].includes(existing.status)) throw new BadRequestError(`VIN ${vin} is already in stock for this brand`);
        const unit = existing ?? (await t.vehicleUnit.create({ data: { brandId, productId: line.productId, vin, status: "ON_ORDER", colour: (data.colour as string) || null, modelYear: product.modelYear } }));
        await setStatus(t, unit, "PDI_PENDING", actor, `Received on ${doc.number}`, { warehouseId: doc.warehouseId, purchaseCost: cost, receivedAt: doc.docDate, productId: line.productId, ...(data.colour ? { colour: String(data.colour) } : {}) });
        await t.inventoryDocumentLine.update({ where: { id: line.id }, data: { vehicleUnitId: unit.id, vin, qty: 1 } });
        await move(t, { brandId, productId: line.productId, vehicleUnitId: unit.id, warehouseId: doc.warehouseId, qtyIn: 1, totalCost: cost, movementType: "RECEIPT", doc: ref, at: doc.docDate, userId: actor.userId });
        changed.push({ id: unit.id, status: "PDI_PENDING" });
        total += cost;
      } else {
        const qty = num(line.qty);
        if (!(qty > 0)) throw new BadRequestError(`Line ${line.position}: the quantity must be positive`);
        await move(t, { brandId, productId: line.productId, warehouseId: doc.warehouseId, batchNo: line.batchNo, qtyIn: qty, totalCost: round2(cost * qty), movementType: "RECEIPT", doc: ref, at: doc.docDate, userId: actor.userId });
        total += round2(cost * qty);
      }
      await t.product.update({ where: { id: line.productId }, data: { costPrice: cost } });
    }
    const s = await settingsFor(t, brandId);
    const j = await journal(t, brandId, doc.docDate, receiptJournal(accountMap(s.accounts), doc.number, total), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "RECEIVED", postedAt: new Date(), total: round2(total / (rate || 1)), updatedById: actor.userId } });
    // the purchase order follows its receipts
    if (doc.parentId) await refreshPurchaseOrder(t, doc.parentId, brandId);
    return posted(doc.id, "RECEIVED", [j], changed);
  });
}

async function refreshPurchaseOrder(t: Tx, parentId: string, brandId: string) {
  let po = await t.inventoryDocument.findUnique({ where: { id: parentId }, include: { lines: true } });
  if (po?.type === "SHIPMENT" && po.parentId) po = await t.inventoryDocument.findUnique({ where: { id: po.parentId }, include: { lines: true } });
  if (!po || po.type !== "PO" || po.brandId !== brandId || !["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status)) return;
  const children = await t.inventoryDocument.findMany({ where: { brandId, OR: [{ parentId: po.id }, { type: "GRN", parentId: { in: (await t.inventoryDocument.findMany({ where: { parentId: po.id, type: "SHIPMENT" }, select: { id: true } })).map((s) => s.id) } }] }, select: { id: true, type: true, status: true } });
  const grnIds = children.filter((c) => c.type === "GRN" && c.status === "RECEIVED").map((c) => c.id);
  const received = await t.inventoryDocumentLine.groupBy({ by: ["productId"], where: { documentId: { in: grnIds } }, _sum: { qty: true } });
  const got = new Map(received.map((r) => [r.productId, num(r._sum.qty)]));
  const ordered = new Map<string, number>();
  for (const l of po.lines) if (l.productId) ordered.set(l.productId, (ordered.get(l.productId) ?? 0) + num(l.qty));
  const complete = [...ordered].every(([p, q]) => (got.get(p) ?? 0) >= q - 1e-9);
  await t.inventoryDocument.update({ where: { id: po.id }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
}

// ───────────────────────────── vendor bill ─────────────────────────────

/** Bill opened: Dr GRNI (what the receipt accrued) / Cr AP; a difference goes to purchase price variance. */
export function postBill(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "BILL", ["DRAFT"]);
    if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
    await openPeriod(t, brandId, doc.docDate);
    const billed = round2(doc.lines.reduce((s, l) => s + num(l.lineTotal), 0) * num(doc.exchangeRate));
    let received = billed;
    if (doc.parentId) {
      const grn = await t.inventoryDocument.findUnique({ where: { id: doc.parentId }, select: { type: true, brandId: true, status: true, total: true, exchangeRate: true } });
      if (grn?.type === "GRN" && grn.brandId === brandId && grn.status === "RECEIVED") received = round2(num(grn.total) * num(grn.exchangeRate));
    }
    const s = await settingsFor(t, brandId);
    const j = await journal(t, brandId, doc.docDate, billJournal(accountMap(s.accounts), doc.number, billed, received), { type: "BILL", id: doc.id });
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "OPEN", postedAt: new Date(), total: round2(billed / (num(doc.exchangeRate) || 1)), updatedById: actor.userId } });
    return posted(doc.id, "OPEN", [j]);
  });
}

export function payBill(docId: string, brandId: string, amount: number, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "BILL", ["OPEN", "PARTIALLY_PAID"]);
    const balance = round2(num(doc.total) - num(doc.amountPaid));
    if (!(amount > 0) || amount > balance + 0.005) throw new BadRequestError(`The payment must be between 0 and the open balance of ${balance.toFixed(2)}`);
    const paid = round2(num(doc.amountPaid) + amount);
    const status = paid >= num(doc.total) - 0.005 ? "PAID" : "PARTIALLY_PAID";
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { amountPaid: paid, status, updatedById: actor.userId } });
    return posted(doc.id, status, []);
  });
}

// ───────────────────────────── landed cost ─────────────────────────────

/** Allocates the voucher's charges to its vehicles: unit landed cost up, Dr Inventory / Cr Landed cost clearing. */
export function postLandedCost(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "LANDED_COST", ["DRAFT"]);
    await openPeriod(t, brandId, doc.docDate);
    const data = json(doc.data);
    const unitIds = Array.isArray(data.unitIds) ? (data.unitIds as string[]) : [];
    const units = await t.vehicleUnit.findMany({ where: { id: { in: unitIds }, brandId }, orderBy: { vin: "asc" } });
    if (units.length !== unitIds.length || units.length === 0) throw new BadRequestError("Choose the vehicles of this brand the charges belong to");
    const notReceived = units.find((u) => !u.warehouseId);
    if (notReceived) throw new BadRequestError(`${notReceived.vin} has not been received into a warehouse yet – receive it first`);
    const total = round2(doc.lines.reduce((s, l) => s + num(l.lineTotal), 0) * num(doc.exchangeRate));
    const manual = json(data.manual) as Record<string, number>;
    const weights = json(data.weights) as Record<string, number>;
    let shares: Map<string, number>;
    try {
      shares = allocateLandedCost(total, units.map((u) => ({ id: u.id, value: num(u.purchaseCost), weight: Number(weights[u.id]) || null, manual: Number(manual[u.id]) || 0 })), ((data.method as string) || "VALUE") as AllocationMethod);
    } catch (e) {
      throw new BadRequestError(e instanceof Error ? e.message : "The charges could not be allocated");
    }
    const ref = { type: "LANDED_COST", id: doc.id };
    for (const u of units) {
      const share = shares.get(u.id) ?? 0;
      await t.vehicleUnit.update({ where: { id: u.id }, data: { landedCost: { increment: share } } });
      await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId!, totalCost: share, movementType: "LANDED_COST", doc: ref, at: doc.docDate, userId: actor.userId });
    }
    const s = await settingsFor(t, brandId);
    const j = await journal(t, brandId, doc.docDate, landedCostJournal(accountMap(s.accounts), doc.number, total), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "ALLOCATED", postedAt: new Date(), total: round2(total / (num(doc.exchangeRate) || 1)), data: { ...data, allocation: Object.fromEntries(shares) } as Prisma.InputJsonValue, updatedById: actor.userId } });
    return posted(doc.id, "ALLOCATED", [j]);
  });
}

// ───────────────────────────── transfers within a brand ─────────────────────────────

const TRANSFERABLE: VehicleStatus[] = ["PDI_PENDING", "AVAILABLE", "DEMO", "ON_HOLD"];

export function shipTransfer(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "TRANSFER", ["DRAFT"]);
    if (!doc.warehouseId || !doc.toWarehouseId || doc.warehouseId === doc.toWarehouseId) throw new BadRequestError("Choose two different warehouses of the brand");
    if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
    const s = await openPeriod(t, brandId, doc.docDate);
    const ref = { type: "TRANSFER", id: doc.id };
    for (const line of doc.lines) {
      if (line.vehicleUnitId) {
        const u = await t.vehicleUnit.findUnique({ where: { id: line.vehicleUnitId } });
        if (!u || u.brandId !== brandId || u.warehouseId !== doc.warehouseId) throw new BadRequestError(`Line ${line.position}: the vehicle is not in the source warehouse`);
        if (!TRANSFERABLE.includes(u.status as VehicleStatus)) throw new BadRequestError(`${u.vin} is ${u.status.toLowerCase()} and cannot be moved`);
        const cost = unitCost(u);
        await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: doc.warehouseId, qtyOut: 1, totalCost: cost, movementType: "TRANSFER_OUT", doc: ref, at: doc.docDate, userId: actor.userId });
        await t.inventoryDocumentLine.update({ where: { id: line.id }, data: { unitCost: cost, lineTotal: cost } });
        await t.vehicleUnit.update({ where: { id: u.id }, data: { warehouseId: null } }); // on the road
      } else if (line.productId) {
        const qty = num(line.qty);
        const cost = await issueCost(t, brandId, line.productId, doc.warehouseId, line.batchNo ?? "", qty, s.partsValuation);
        await move(t, { brandId, productId: line.productId, warehouseId: doc.warehouseId, batchNo: line.batchNo, qtyOut: qty, totalCost: cost, movementType: "TRANSFER_OUT", doc: ref, at: doc.docDate, userId: actor.userId });
        await t.inventoryDocumentLine.update({ where: { id: line.id }, data: { unitCost: round2(cost / qty), lineTotal: cost } });
      }
    }
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "IN_TRANSIT", postedAt: new Date(), updatedById: actor.userId } });
    return posted(doc.id, "IN_TRANSIT", []);
  });
}

export function receiveTransfer(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "TRANSFER", ["IN_TRANSIT"]);
    const at = new Date();
    await openPeriod(t, brandId, at);
    const ref = { type: "TRANSFER", id: doc.id };
    for (const line of doc.lines) {
      const cost = num(line.lineTotal);
      if (line.vehicleUnitId) {
        const u = await t.vehicleUnit.findUniqueOrThrow({ where: { id: line.vehicleUnitId } });
        await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: doc.toWarehouseId!, qtyIn: 1, totalCost: cost, movementType: "TRANSFER_IN", doc: ref, at, userId: actor.userId });
        await t.vehicleUnit.update({ where: { id: u.id }, data: { warehouseId: doc.toWarehouseId } });
      } else if (line.productId) {
        await move(t, { brandId, productId: line.productId, warehouseId: doc.toWarehouseId!, batchNo: line.batchNo, qtyIn: num(line.qty), totalCost: cost, movementType: "TRANSFER_IN", doc: ref, at, userId: actor.userId });
      }
    }
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "RECEIVED", updatedById: actor.userId } });
    return posted(doc.id, "RECEIVED", []);
  });
}

// ───────────────────────────── adjustments, write-offs, returns ─────────────────────────────

/** Value of an adjustment in NGN (absolute) – what the approval limit is compared with. */
export async function adjustmentValue(docId: string, brandId: string): Promise<number> {
  const doc = await unsafeDb.inventoryDocument.findUnique({ where: { id: docId }, include: { lines: true } });
  if (!doc || doc.brandId !== brandId) throw new BadRequestError("Document not found");
  let total = 0;
  for (const l of doc.lines) {
    if (l.vehicleUnitId) {
      const u = await unsafeDb.vehicleUnit.findUnique({ where: { id: l.vehicleUnitId } });
      const action = String(json(l.data).action ?? "WRITE_OFF");
      total += action === "WRITE_OFF" ? (u ? unitCost(u) : 0) : action === "REVALUE" ? Math.abs(num(l.unitCost)) : 0;
    } else total += Math.abs(num(l.qty) * num(l.unitCost));
  }
  return round2(total);
}

/**
 * Posts an adjustment. Vehicle lines: WRITE_OFF (unit leaves stock at its cost), REVALUE (unitCost = change of
 * value, + or −), HOLD / RELEASE (status only). Quantity lines: qty is the change (+ found, − lost).
 */
export function postAdjustment(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "ADJUSTMENT", ["DRAFT", "PENDING_APPROVAL"]);
    if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
    const s = await openPeriod(t, brandId, doc.docDate);
    const ref = { type: "ADJUSTMENT", id: doc.id };
    const changed: Posted["units"] = [];
    let delta = 0;
    for (const line of doc.lines) {
      if (line.vehicleUnitId) {
        const u = await t.vehicleUnit.findUnique({ where: { id: line.vehicleUnitId } });
        if (!u || u.brandId !== brandId) throw new BadRequestError(`Line ${line.position}: vehicle not found`);
        const action = String(json(line.data).action ?? "WRITE_OFF");
        if (action === "WRITE_OFF") {
          if (!u.warehouseId) throw new BadRequestError(`${u.vin} is not in a warehouse`);
          const cost = unitCost(u);
          await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, qtyOut: 1, totalCost: cost, movementType: "ADJUSTMENT", doc: ref, at: doc.docDate, userId: actor.userId });
          await setStatus(t, u, "WRITTEN_OFF", actor, `${doc.number}: ${doc.reference ?? "write-off"}`, { damageNotes: doc.notes ?? u.damageNotes });
          changed.push({ id: u.id, status: "WRITTEN_OFF" });
          delta -= cost;
        } else if (action === "REVALUE") {
          const change = num(line.unitCost);
          if (!u.warehouseId) throw new BadRequestError(`${u.vin} is not in a warehouse`);
          if (unitCost(u) + change < 0) throw new BadRequestError(`${u.vin}: the value cannot become negative`);
          await t.vehicleUnit.update({ where: { id: u.id }, data: { landedCost: { increment: change } } });
          await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, totalCost: change, movementType: "LANDED_COST", doc: ref, at: doc.docDate, userId: actor.userId });
          delta += change;
        } else {
          const to: VehicleStatus = action === "HOLD" ? "ON_HOLD" : "PDI_PENDING";
          await setStatus(t, u, to, actor, `${doc.number}: ${doc.reference ?? action.toLowerCase()}`, action === "HOLD" ? { damageNotes: doc.notes ?? u.damageNotes } : {});
          changed.push({ id: u.id, status: to });
        }
      } else if (line.productId) {
        const qty = num(line.qty);
        if (!doc.warehouseId) throw new BadRequestError("Choose the warehouse");
        if (qty > 0) {
          const cost = round2(qty * num(line.unitCost));
          await move(t, { brandId, productId: line.productId, warehouseId: doc.warehouseId, batchNo: line.batchNo, qtyIn: qty, totalCost: cost, movementType: "ADJUSTMENT", doc: ref, at: doc.docDate, userId: actor.userId });
          delta += cost;
        } else if (qty < 0) {
          const cost = await issueCost(t, brandId, line.productId, doc.warehouseId, line.batchNo ?? "", -qty, s.partsValuation);
          await move(t, { brandId, productId: line.productId, warehouseId: doc.warehouseId, batchNo: line.batchNo, qtyOut: -qty, totalCost: cost, movementType: "ADJUSTMENT", doc: ref, at: doc.docDate, userId: actor.userId });
          delta -= cost;
        }
      }
    }
    const j = await journal(t, brandId, doc.docDate, adjustmentJournal(accountMap(s.accounts), doc.number, round2(delta)), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "ADJUSTED", postedAt: new Date(), total: round2(Math.abs(delta)), updatedById: actor.userId } });
    return posted(doc.id, "ADJUSTED", [j], changed);
  });
}

/** Purchase return / vendor credit: the units go back to the vendor. Dr AP / Cr Inventory. */
export function postVendorCredit(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "VENDOR_CREDIT", ["DRAFT"]);
    if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
    const s = await openPeriod(t, brandId, doc.docDate);
    const ref = { type: "VENDOR_CREDIT", id: doc.id };
    const changed: Posted["units"] = [];
    let total = 0;
    for (const line of doc.lines) {
      if (line.vehicleUnitId) {
        const u = await t.vehicleUnit.findUnique({ where: { id: line.vehicleUnitId } });
        if (!u || u.brandId !== brandId || !u.warehouseId) throw new BadRequestError(`Line ${line.position}: the vehicle is not in stock`);
        const cost = unitCost(u);
        await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, qtyOut: 1, totalCost: cost, movementType: "RETURN", doc: ref, at: doc.docDate, userId: actor.userId });
        await setStatus(t, u, "RETURNED", actor, `Returned on ${doc.number}`);
        await t.inventoryDocumentLine.update({ where: { id: line.id }, data: { unitCost: cost, lineTotal: cost } });
        changed.push({ id: u.id, status: "RETURNED" });
        total += cost;
      } else if (line.productId && doc.warehouseId) {
        const qty = num(line.qty);
        const cost = await issueCost(t, brandId, line.productId, doc.warehouseId, line.batchNo ?? "", qty, s.partsValuation);
        await move(t, { brandId, productId: line.productId, warehouseId: doc.warehouseId, batchNo: line.batchNo, qtyOut: qty, totalCost: cost, movementType: "RETURN", doc: ref, at: doc.docDate, userId: actor.userId });
        total += cost;
      }
    }
    const j = await journal(t, brandId, doc.docDate, returnJournal(accountMap(s.accounts), doc.number, round2(total)), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "OPEN", postedAt: new Date(), total: round2(total), updatedById: actor.userId } });
    return posted(doc.id, "OPEN", [j], changed);
  });
}

// ───────────────────────────── inter-brand transfer (a sale between two legal entities) ─────────────────────────────

/** Ship: the selling brand's units leave at cost; the receivable is the agreed transfer price. */
export function shipInterBrand(docId: string, brandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const doc = await loadDoc(t, docId, brandId, "INTER_BRAND", ["APPROVED"]);
    const s = await openPeriod(t, brandId, doc.docDate);
    const ref = { type: "INTER_BRAND", id: doc.id };
    const changed: Posted["units"] = [];
    let cost = 0;
    let price = 0;
    for (const line of doc.lines) {
      const u = line.vehicleUnitId ? await t.vehicleUnit.findUnique({ where: { id: line.vehicleUnitId } }) : null;
      if (!u || u.brandId !== brandId || !u.warehouseId) throw new BadRequestError(`Line ${line.position}: the vehicle is not in this brand's stock`);
      if (!["PDI_PENDING", "AVAILABLE"].includes(u.status)) throw new BadRequestError(`${u.vin} is ${u.status.toLowerCase()} and cannot be transferred`);
      const c = unitCost(u);
      await move(t, { brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, qtyOut: 1, totalCost: c, movementType: "INTER_BRAND_OUT", doc: ref, at: doc.docDate, userId: actor.userId });
      await setStatus(t, u, "TRANSFERRED", actor, `Inter-brand transfer ${doc.number}`);
      changed.push({ id: u.id, status: "TRANSFERRED" });
      cost += c;
      price += num(line.unitCost);
    }
    const j = await journal(t, brandId, doc.docDate, interBrandOutJournal(accountMap(s.accounts), doc.number, round2(cost), round2(price)), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "SHIPPED", postedAt: new Date(), total: round2(price), updatedById: actor.userId } });
    return posted(doc.id, "SHIPPED", [j], changed);
  });
}

/**
 * Receive in the buying brand: a NEW unit of that brand at the transfer price (the seller's cost history does
 * not travel with it). `toBrandId` is the acting brand here – the caller must have access to it.
 */
export function receiveInterBrand(docId: string, toBrandId: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    await t.$queryRaw`SELECT id FROM "InventoryDocument" WHERE id = ${docId} FOR UPDATE`;
    const doc = await t.inventoryDocument.findUnique({ where: { id: docId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!doc || doc.type !== "INTER_BRAND" || doc.toBrandId !== toBrandId) throw new BadRequestError("Document not found");
    if (doc.status !== "SHIPPED") throw new BadRequestError("Only shipped transfers can be received");
    if (!doc.toWarehouseId) throw new BadRequestError("Choose the receiving warehouse");
    const at = new Date();
    const s = await openPeriod(t, toBrandId, at);
    const ref = { type: "INTER_BRAND", id: doc.id };
    const changed: Posted["units"] = [];
    let price = 0;
    for (const line of doc.lines) {
      const toProductId = String(json(line.data).toProductId ?? "");
      const product = await t.product.findUnique({ where: { id: toProductId }, select: { brandId: true, modelYear: true } });
      if (!product || product.brandId !== toBrandId) throw new BadRequestError(`Line ${line.position}: choose the receiving brand's item`);
      const source = await t.vehicleUnit.findUniqueOrThrow({ where: { id: line.vehicleUnitId! } });
      const p = num(line.unitCost);
      const unit = await t.vehicleUnit.create({ data: { brandId: toBrandId, productId: toProductId, vin: source.vin, engineNo: source.engineNo, colour: source.colour, colourInterior: source.colourInterior, modelYear: source.modelYear, keyNo: source.keyNo, customsDocNo: source.customsDocNo, importDutyPaid: source.importDutyPaid, status: "ON_ORDER" } });
      await setStatus(t, unit, "PDI_PENDING", actor, `Inter-brand transfer ${doc.number}`, { warehouseId: doc.toWarehouseId, purchaseCost: p, receivedAt: at });
      await move(t, { brandId: toBrandId, productId: toProductId, vehicleUnitId: unit.id, warehouseId: doc.toWarehouseId, qtyIn: 1, totalCost: p, movementType: "INTER_BRAND_IN", doc: ref, at, userId: actor.userId });
      changed.push({ id: unit.id, status: "PDI_PENDING" });
      price += p;
    }
    const j = await journal(t, toBrandId, at, interBrandInJournal(accountMap(s.accounts), doc.number, round2(price)), ref);
    await t.inventoryDocument.update({ where: { id: doc.id }, data: { status: "RECEIVED", updatedById: actor.userId } });
    return posted(doc.id, "RECEIVED", [j], changed);
  });
}

/** What the receiving brand may know of an inter-brand transfer: the units and the transfer price – never the seller's cost. */
export async function incomingInterBrand(toBrandIds: string[]) {
  const docs = await unsafeDb.inventoryDocument.findMany({ where: { type: "INTER_BRAND", toBrandId: { in: toBrandIds }, status: { not: "DRAFT" } }, include: { lines: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return docs.map((d) => ({ id: d.id, number: d.number, status: d.status, fromBrandId: d.brandId, toBrandId: d.toBrandId!, toWarehouseId: d.toWarehouseId, docDate: d.docDate, data: json(d.data), lines: d.lines.map((l) => ({ id: l.id, position: l.position, vin: l.vin, description: l.description, price: num(l.unitCost), toProductId: (json(l.data).toProductId as string) ?? null })) }));
}

/** Approval / receiving-side edits of an inter-brand transfer by the receiving brand (it cannot write the row itself: RLS). */
export async function patchInterBrand(docId: string, toBrandId: string, patch: { data?: Record<string, unknown>; status?: string; toWarehouseId?: string; lineProducts?: Record<string, string> }) {
  return tx(async (t) => {
    await t.$queryRaw`SELECT id FROM "InventoryDocument" WHERE id = ${docId} FOR UPDATE`;
    const doc = await t.inventoryDocument.findUnique({ where: { id: docId }, include: { lines: true } });
    if (!doc || doc.type !== "INTER_BRAND" || doc.toBrandId !== toBrandId) throw new BadRequestError("Document not found");
    for (const [lineId, productId] of Object.entries(patch.lineProducts ?? {})) {
      const line = doc.lines.find((l) => l.id === lineId);
      const product = await t.product.findUnique({ where: { id: productId }, select: { brandId: true } });
      if (!line || product?.brandId !== toBrandId) throw new BadRequestError("Choose an item of the receiving brand");
      await t.inventoryDocumentLine.update({ where: { id: lineId }, data: { data: { ...json(line.data), toProductId: productId } as Prisma.InputJsonValue } });
    }
    return t.inventoryDocument.update({ where: { id: docId }, data: { ...(patch.data ? { data: { ...json(doc.data), ...patch.data } as Prisma.InputJsonValue } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.toWarehouseId ? { toWarehouseId: patch.toWarehouseId } : {}) } });
  });
}

// ───────────────────────────── unit status, reservation, sale ─────────────────────────────

/** A status change that needs no ledger row (shipment progress, PDI result, demo fleet, hold / release). */
export function changeUnitStatus(unitId: string, brandId: string, to: VehicleStatus, actor: Actor, note: string | null, patch: Prisma.VehicleUnitUncheckedUpdateInput = {}) {
  return tx(async (t) => {
    await t.$queryRaw`SELECT id FROM "VehicleUnit" WHERE id = ${unitId} FOR UPDATE`;
    const u = await t.vehicleUnit.findUnique({ where: { id: unitId } });
    if (!u || u.brandId !== brandId) throw new BadRequestError("Vehicle not found");
    await setStatus(t, u, to, actor, note, patch);
    return { id: u.id, from: u.status, status: to, vin: u.vin };
  });
}

/**
 * Reserves an available unit for a deal. The row lock makes this a single-winner operation: of two
 * executives reserving the same unit at the same moment exactly one succeeds.
 */
export function reserveUnit(unitId: string, brandId: string, dealId: string, until: Date, actor: Actor) {
  return tx(async (t) => {
    await t.$queryRaw`SELECT id FROM "VehicleUnit" WHERE id = ${unitId} FOR UPDATE`;
    const u = await t.vehicleUnit.findUnique({ where: { id: unitId } });
    if (!u || u.brandId !== brandId) throw new BadRequestError("Vehicle not found");
    if (u.status !== "AVAILABLE") throw new BadRequestError(u.status === "RESERVED" ? "This vehicle was just reserved by someone else" : "This vehicle is not available");
    await setStatus(t, u, "RESERVED", actor, "Reserved for a deal", { dealId, reservedById: actor.userId, reservedUntil: until });
    // one reservation per deal: an earlier one goes back to stock
    const others = await t.vehicleUnit.findMany({ where: { dealId, status: "RESERVED", id: { not: unitId } } });
    for (const o of others) await setStatus(t, o, "AVAILABLE", actor, "Replaced by another reservation", { dealId: null, reservedById: null, reservedUntil: null });
    return { id: u.id, vin: u.vin, colour: u.colour, released: others.map((o) => o.id) };
  });
}

export function releaseDealUnits(dealId: string, actor: Actor, note = "Reservation released"): Promise<string[]> {
  return tx(async (t) => {
    const units = await t.vehicleUnit.findMany({ where: { dealId, status: "RESERVED" } });
    for (const u of units) await setStatus(t, u, "AVAILABLE", actor, note, { dealId: null, reservedById: null, reservedUntil: null });
    return units.map((u) => u.id);
  });
}

export function extendReservation(unitId: string, brandId: string, until: Date) {
  return unsafeDb.vehicleUnit.updateMany({ where: { id: unitId, brandId, status: "RESERVED" }, data: { reservedUntil: until } });
}

/** Scheduler: reservations past their expiry go back to available stock. Returns what was released. */
export async function releaseExpiredReservations(now = new Date()) {
  const due = await unsafeDb.vehicleUnit.findMany({ where: { status: "RESERVED", reservedUntil: { lt: now } }, select: { id: true, brandId: true, dealId: true, vin: true, reservedById: true } });
  const released: typeof due = [];
  for (const d of due) {
    await tx(async (t) => {
      const u = await t.vehicleUnit.findUnique({ where: { id: d.id } });
      if (!u || u.status !== "RESERVED" || !u.reservedUntil || u.reservedUntil >= now) return;
      await setStatus(t, u, "AVAILABLE", { userId: null }, "Reservation expired", { dealId: null, reservedById: null, reservedUntil: null });
      if (u.dealId) await t.deal.updateMany({ where: { id: u.dealId, vinChassisNo: u.vin }, data: { vinChassisNo: null } });
      released.push(d);
    });
  }
  return released;
}

/** Sales order allocation: the deal's reserved units become allocated to the order. */
export function allocateUnits(dealId: string, salesOrderId: string, brandId: string, actor: Actor) {
  return tx(async (t) => {
    const units = await t.vehicleUnit.findMany({ where: { dealId, brandId, status: "RESERVED" }, orderBy: { vin: "asc" } });
    for (const u of units) await setStatus(t, u, "ALLOCATED", actor, "Allocated to a sales order", { salesOrderId, reservedUntil: null });
    return units.map((u) => ({ id: u.id, vin: u.vin, productId: u.productId }));
  });
}

/** Cancelled order: allocated units return to the deal's reservation. */
export function deallocateUnits(salesOrderId: string, brandId: string, until: Date, actor: Actor) {
  return tx(async (t) => {
    const units = await t.vehicleUnit.findMany({ where: { salesOrderId, brandId, status: "ALLOCATED" } });
    for (const u of units) await setStatus(t, u, "RESERVED", actor, "Sales order cancelled", { salesOrderId: null, reservedUntil: until });
    return units.length;
  });
}

async function issueOnce(t: Tx, u: VehicleUnit, ref: { type: string; id: string }, reference: string, at: Date, actor: Actor): Promise<string | null> {
  if (await t.stockMovement.findFirst({ where: { vehicleUnitId: u.id, movementType: "SALE_ISSUE" }, select: { id: true } })) return null;
  if (!u.warehouseId) return null; // a legacy reference that was never received has no stock value to issue
  const cost = unitCost(u);
  await move(t, { brandId: u.brandId, productId: u.productId, vehicleUnitId: u.id, warehouseId: u.warehouseId, qtyOut: 1, totalCost: cost, movementType: "SALE_ISSUE", doc: ref, at, userId: actor.userId });
  const s = await settingsFor(t, u.brandId);
  return journal(t, u.brandId, at, saleIssueJournal(accountMap(s.accounts), `${reference} / ${u.vin}`, cost), ref);
}

/** Invoice issued: the order's allocated units leave stock at their own landed cost (Dr COGS / Cr Inventory). */
export function issueForInvoice(invoiceId: string, salesOrderId: string, brandId: string, number: string, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const at = new Date();
    const units = await t.vehicleUnit.findMany({ where: { salesOrderId, brandId, status: { in: ["ALLOCATED", "DELIVERED"] } } });
    if (units.some((u) => u.warehouseId)) await openPeriod(t, brandId, at);
    const journals: Array<string | null> = [];
    const changed: Posted["units"] = [];
    for (const u of units) {
      journals.push(await issueOnce(t, u, { type: "INVOICE", id: invoiceId }, number, at, actor));
      if (u.status === "ALLOCATED") {
        await setStatus(t, u, "INVOICED", actor, `Invoiced on ${number}`, { invoiceId, soldAt: at });
        changed.push({ id: u.id, status: "INVOICED" });
      } else await t.vehicleUnit.update({ where: { id: u.id }, data: { invoiceId } });
    }
    return posted(invoiceId, "ISSUED", journals, changed);
  });
}

/** Gate pass: the order's units are handed to the customer. A delivery note documents it. */
export function deliverUnits(salesOrderId: string, brandId: string, number: string, at: Date, actor: Actor): Promise<Posted> {
  return tx(async (t) => {
    const units = await t.vehicleUnit.findMany({ where: { salesOrderId, brandId, status: { in: ["ALLOCATED", "INVOICED"] } }, include: { product: { select: { name: true } } } });
    if (units.length === 0) return posted(salesOrderId, "DELIVERED", []);
    if (units.some((u) => u.warehouseId)) await openPeriod(t, brandId, at);
    const note = await t.inventoryDocument.create({ data: { brandId, type: "DELIVERY_NOTE", status: "DELIVERED", docDate: at, reference: number, postedAt: new Date(), createdById: actor.userId, data: { salesOrderId }, lines: { create: units.map((u, i) => ({ position: i + 1, productId: u.productId, vehicleUnitId: u.id, vin: u.vin, description: u.product.name, qty: 1 })) } } });
    const journals: Array<string | null> = [];
    const changed: Posted["units"] = [];
    for (const u of units) {
      journals.push(await issueOnce(t, u, { type: "DELIVERY_NOTE", id: note.id }, number, at, actor));
      await setStatus(t, u, "DELIVERED", actor, `Delivered – gate pass ${note.number}`, { deliveredAt: at, soldAt: u.soldAt ?? at, warehouseId: null });
      changed.push({ id: u.id, status: "DELIVERED" });
    }
    return posted(note.id, "DELIVERED", journals, changed);
  });
}

/** Brand change of a deal (approval engine): its reservations stay with the old brand's stock. */
export const releaseForBrandChange = (dealId: string) => releaseDealUnits(dealId, { userId: null }, "Deal moved to another brand");

/** Marks journals as handed to the ERP. */
export async function markJournalsExported(ids: string[]) {
  await unsafeDb.journalEntry.updateMany({ where: { id: { in: ids } }, data: { exportedAt: new Date() } });
}

export function journalForExport(id: string) {
  return unsafeDb.journalEntry.findUnique({ where: { id }, include: { lines: true } });
}

/** The brand's inventory settings (created with defaults on first use). */
export const brandSettings = (brandId: string) => settingsFor(unsafeDb, brandId);

/** Approval stamps of an inter-brand transfer (either side); the caller has verified the approver's role. */
export async function patchInterBrandAny(docId: string, patch: { data: Record<string, unknown>; status?: string }) {
  return tx(async (t) => {
    await t.$queryRaw`SELECT id FROM "InventoryDocument" WHERE id = ${docId} FOR UPDATE`;
    const doc = await t.inventoryDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.type !== "INTER_BRAND" || doc.status !== "PENDING_APPROVAL") throw new BadRequestError("This transfer is not waiting for approval");
    const current = json(doc.data);
    // stamps are merged under the row lock so two simultaneous approvers cannot overwrite each other
    const approvals = { ...json(current.approvals), ...json(patch.data.approvals) };
    const complete = ["fromManager", "fromFinance", "toManager", "toFinance"].every((s) => approvals[s]);
    return t.inventoryDocument.update({ where: { id: docId }, data: { data: { ...current, approvals } as Prisma.InputJsonValue, ...(complete ? { status: "APPROVED" } : {}) } });
  });
}

/** Does this brand exist? (receiver of an inter-brand transfer – brands are a shared directory) */
export async function brandExists(brandId: string): Promise<boolean> {
  return !!(await unsafeDb.brand.findUnique({ where: { id: brandId }, select: { id: true } }));
}
