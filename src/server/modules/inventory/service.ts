/**
 * Inventory writes (prompt 16): master data, documents and their status workflow, unit operations.
 * Access is checked here (brand + permission); the multi-table postings are done by the posting engine
 * (`src/server/db/inventory-posting.ts`) in one transaction each.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { managedBrands } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as posting from "@/server/db/inventory-posting";
import { BadRequestError } from "@/server/errors";
import { dispatchEvent } from "@/server/integrations/events";
import { notify } from "@/server/modules/notifications/service";
import { ADJUSTMENT_ACTIONS, DEFAULT_PDI, INV_DOCS, docSchema, isDocType, settingsSchema, vendorSchema, warehouseSchema, type InvDocType } from "./config";
import { round2 } from "./costing";
import { ACCOUNT_KEYS, accountMap } from "./journal";
import { IN_STOCK, type VehicleStatus } from "./status";
import { normalizeVin, vinProblem } from "./vin";

const num = (d: { toString(): string } | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
const json = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const actor = (ctx: AccessContext) => ({ userId: ctx.userId || null });

/** Permission + brand: the caller must hold the permission AND belong to the brand (or have group scope). */
function assertBrand(ctx: AccessContext, area: "inventory" | "inventoryFinance", action: "create" | "edit" | "approve", brandId: string) {
  if (!hasPermission(ctx, area, action)) throw new ForbiddenError(`You do not have ${action} permission on ${area === "inventory" ? "inventory" : "inventory finance"}`);
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new ForbiddenError("You cannot work on this brand's inventory");
}

async function announce(out: posting.Posted, brandId: string, unitEvent: "vehicle.status_changed" | "vehicle.received" | "vehicle.delivered" = "vehicle.status_changed") {
  for (const u of out.units) await dispatchEvent(unitEvent, u.id, brandId);
  for (const j of out.journalIds) await dispatchEvent("journal.posted", j, brandId);
}

// ───────────────────────────── master data ─────────────────────────────

export async function saveWarehouse(ctx: AccessContext, id: string | null, input: unknown) {
  const data = warehouseSchema.parse(input);
  assertBrand(ctx, "inventory", id ? "edit" : "create", data.brandId);
  const db = scopedDb(ctx);
  if (id) {
    const before = await db.warehouse.findUnique({ where: { id } });
    if (!before) throw new NotFoundError();
    if (before.brandId !== data.brandId) throw new BadRequestError("A warehouse cannot move to another brand");
    const after = await db.warehouse.update({ where: { id }, data: { code: data.code, name: data.name, type: data.type, regionId: data.regionId ?? null, address: data.address ?? null, active: data.active } });
    await audit({ ctx, action: "UPDATE", entity: "Warehouse", entityId: id, brandId: data.brandId, before, after });
    return { id };
  }
  if (await db.warehouse.findFirst({ where: { brandId: data.brandId, code: data.code }, select: { id: true } })) throw new BadRequestError(`Warehouse ${data.code} already exists for this brand`);
  const created = await db.warehouse.create({ data: { ...data, regionId: data.regionId ?? null, address: data.address ?? null } });
  await audit({ ctx, action: "CREATE", entity: "Warehouse", entityId: created.id, brandId: data.brandId, after: created });
  return { id: created.id };
}

export async function saveVendor(ctx: AccessContext, id: string | null, input: unknown) {
  const data = vendorSchema.parse(input);
  assertBrand(ctx, "inventory", id ? "edit" : "create", data.brandId);
  const db = scopedDb(ctx);
  // bank details and tax id belong to the finance tier: others cannot set or overwrite them
  const finance = hasPermission(ctx, "inventoryFinance", "read");
  const fromPage = !!(input as { page?: boolean }).page;
  if (data.ownerId) {
    const ok = await db.user.findFirst({ where: { id: data.ownerId, active: true, OR: [{ profile: { scope: "ALL" } }, { memberships: { some: { territory: { brandId: data.brandId } } } }] }, select: { id: true } });
    if (!ok) throw new BadRequestError("The vendor owner has no access to this brand");
  }
  const values = {
    type: data.type,
    name: data.name,
    contactName: data.contactName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    currency: data.currency,
    paymentTerms: data.paymentTerms ?? null,
    address: data.address ?? null,
    active: data.active,
    // the Create Vendor page fields – only from that page (the short form in Inventory settings leaves them alone)
    ...(fromPage ? {
    website: data.website ? (/^https?:\/\//i.test(data.website) ? data.website : `https://${data.website}`) : null,
    glAccount: data.glAccount ?? null,
    category: data.category ?? null,
    emailOptOut: data.emailOptOut,
    city: data.city ?? null,
    state: data.state ?? null,
    zipCode: data.zipCode ?? null,
    country: data.country ?? null,
    description: data.description ?? null,
    ...(data.ownerId ? { ownerId: data.ownerId } : {}),
    } : {}),
    ...(finance ? { taxId: data.taxId ?? null, bankDetails: data.bankDetails ?? null } : {}),
  };
  if (id) {
    const before = await db.vendor.findUnique({ where: { id } });
    if (!before) throw new NotFoundError();
    if (before.brandId !== data.brandId) throw new BadRequestError("A vendor cannot move to another brand");
    await db.vendor.update({ where: { id }, data: values });
    await audit({ ctx, action: "UPDATE", entity: "Vendor", entityId: id, brandId: data.brandId, before: { name: before.name }, after: { name: data.name } });
    return { id };
  }
  if (await db.vendor.findFirst({ where: { brandId: data.brandId, name: data.name }, select: { id: true } })) throw new BadRequestError("This vendor already exists for the brand");
  const created = await db.vendor.create({ data: { brandId: data.brandId, ownerId: ctx.userId || null, ...values } });
  await audit({ ctx, action: "CREATE", entity: "Vendor", entityId: created.id, brandId: data.brandId, after: { name: created.name, type: created.type } });
  return { id: created.id };
}

/** Limits, period lock, valuation method, PDI template and the account mapping of ONE brand (finance). */
export async function saveSettings(ctx: AccessContext, brandId: string, input: unknown) {
  assertBrand(ctx, "inventoryFinance", "edit", brandId);
  const data = settingsSchema.parse(input);
  const before = await posting.brandSettings(brandId);
  const accounts = Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, data.accounts[k]?.trim() || accountMap(before.accounts)[k]]));
  const after = await scopedDb(ctx).inventorySettings.update({ where: { brandId }, data: { reservationDays: data.reservationDays, adjustmentApprovalLimit: data.adjustmentApprovalLimit, poApprovalLimit: data.poApprovalLimit, lockDate: data.lockDate ?? null, partsValuation: data.partsValuation, pdiTemplate: data.pdiTemplate, accounts } });
  await audit({ ctx, action: "UPDATE", entity: "InventorySettings", entityId: brandId, brandId, before, after });
}

/** Inventory fields of an item (reorder point, tracking, HS code). */
export async function saveItemStockFields(ctx: AccessContext, productId: string, input: { reorderLevel?: string | number | null; reorderQty?: string | number | null; hsCode?: string | null; uom?: string | null; trackingType?: string | null }) {
  const db = scopedDb(ctx);
  const product = await db.product.findUnique({ where: { id: productId }, select: { brandId: true, trackingType: true } });
  if (!product) throw new NotFoundError();
  assertBrand(ctx, "inventory", "edit", product.brandId);
  const n = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
  const tracking = ["SERIAL", "BATCH", "NONE"].includes(input.trackingType ?? "") ? input.trackingType! : product.trackingType;
  if (tracking !== product.trackingType && (await db.stockMovement.findFirst({ where: { productId }, select: { id: true } }))) throw new BadRequestError("The tracking type cannot change once the item has stock movements");
  await db.product.update({ where: { id: productId }, data: { reorderLevel: n(input.reorderLevel), reorderQty: n(input.reorderQty), hsCode: input.hsCode?.trim() || null, uom: input.uom?.trim() || "unit", trackingType: tracking, valuationMethod: tracking === "SERIAL" ? "SPECIFIC" : "WEIGHTED_AVERAGE" } });
  await audit({ ctx, action: "UPDATE", entity: "Product", entityId: productId, brandId: product.brandId, after: { reorderLevel: input.reorderLevel, reorderQty: input.reorderQty, trackingType: tracking } });
}

// ───────────────────────────── documents: create / edit ─────────────────────────────

type Db = ReturnType<typeof scopedDb>;

/**
 * Prices a user without cost access may not set: they come from the purchase order the document follows, or
 * from the item's last purchase cost – never from the request.
 */
async function trustedCosts(db: Db, brandId: string, parentId: string | null | undefined): Promise<(productId: string) => Promise<number>> {
  const fromOrder = new Map<string, number>();
  let rate = 1;
  let id = parentId ?? null;
  for (let hop = 0; id && hop < 3; hop++) {
    const doc = await db.inventoryDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!doc || doc.brandId !== brandId) break;
    if (doc.type === "PO") {
      rate = num(doc.exchangeRate);
      // the net price per unit (after the line discount) is what the goods cost
      for (const l of doc.lines) if (l.productId) fromOrder.set(l.productId, num(l.qty) > 0 && num(l.lineTotal) > 0 ? num(l.lineTotal) / num(l.qty) : num(l.unitCost));
      break;
    }
    id = doc.parentId;
  }
  return async (productId) => {
    if (fromOrder.has(productId)) return round2(fromOrder.get(productId)! * rate);
    return num((await db.product.findUnique({ where: { id: productId }, select: { costPrice: true } }))?.costPrice);
  };
}

async function buildLines(db: Db, type: InvDocType, brandId: string, lines: Array<ReturnType<typeof docSchema.parse>["lines"][number]>, costOf: ((productId: string) => Promise<number>) | null = null) {
  const cfg = INV_DOCS[type];
  const out: Array<Omit<Prisma.InventoryDocumentLineUncheckedCreateInput, "documentId">> = [];
  const seenUnits = new Set<string>();
  for (const [i, l] of lines.entries()) {
    const pos = i + 1;
    const data = { ...l.data };
    if (cfg.lines === "CHARGE") {
      if (!l.description) throw new BadRequestError(`Line ${pos}: describe the charge`);
      if (!(l.unitCost > 0)) throw new BadRequestError(`Line ${pos}: enter the amount`);
      out.push({ position: pos, description: l.description, qty: 1, unitCost: l.unitCost, lineTotal: round2(l.unitCost), data: data as Prisma.InputJsonValue });
      continue;
    }
    if (cfg.lines === "UNIT" && l.vehicleUnitId) {
      if (seenUnits.has(l.vehicleUnitId)) throw new BadRequestError(`Line ${pos}: this vehicle is on the document twice`);
      seenUnits.add(l.vehicleUnitId);
      const unit = await db.vehicleUnit.findUnique({ where: { id: l.vehicleUnitId }, include: { product: { select: { name: true } } } });
      if (!unit || unit.brandId !== brandId) throw new BadRequestError(`Line ${pos}: the vehicle does not belong to this brand`);
      if (costOf && (type === "INTER_BRAND" || data.action === "REVALUE")) throw new ForbiddenError("Transfer prices and revaluations need inventory finance access");
      if (type === "INTER_BRAND" && !(l.unitCost > 0)) throw new BadRequestError(`Line ${pos}: enter the transfer price`);
      if (type === "ADJUSTMENT") {
        const action = String(data.action ?? "WRITE_OFF");
        if (!(ADJUSTMENT_ACTIONS as readonly string[]).includes(action)) throw new BadRequestError(`Line ${pos}: unknown adjustment`);
        data.action = action;
      }
      // the transfer price / revaluation amount is the only cost a user enters on a unit line
      const cost = type === "INTER_BRAND" || (type === "ADJUSTMENT" && data.action === "REVALUE") ? l.unitCost : 0;
      out.push({ position: pos, productId: unit.productId, vehicleUnitId: unit.id, vin: unit.vin, description: l.description ?? unit.product.name, qty: 1, unitCost: cost, lineTotal: round2(cost), data: data as Prisma.InputJsonValue });
      continue;
    }
    if (!l.productId) throw new BadRequestError(`Line ${pos}: choose ${cfg.lines === "UNIT" ? "a vehicle or an item" : "the item"}`);
    const product = await db.product.findUnique({ where: { id: l.productId }, select: { brandId: true, name: true, trackingType: true } });
    if (!product || product.brandId !== brandId) throw new BadRequestError(`Line ${pos}: the item does not belong to this brand`);
    if (type === "INTER_BRAND") throw new BadRequestError(`Line ${pos}: inter-brand transfers move vehicles – choose a vehicle`);
    const serial = product.trackingType === "SERIAL";
    if (cfg.lines === "UNIT" && serial) throw new BadRequestError(`Line ${pos}: choose the vehicle (VIN), not the model`);
    let vin: string | null = null;
    if (cfg.lines === "ITEM_VIN" && serial && l.vin) {
      vin = normalizeVin(l.vin);
      const problem = vinProblem(vin);
      if (problem) throw new BadRequestError(`Line ${pos} (${vin}): ${problem}`);
    }
    const qty = cfg.lines === "ITEM_VIN" && serial ? 1 : l.qty;
    if (type !== "ADJUSTMENT" && !(qty > 0)) throw new BadRequestError(`Line ${pos}: the quantity must be positive`);
    if (type === "ADJUSTMENT" && qty === 0) throw new BadRequestError(`Line ${pos}: enter the quantity change (+ or −)`);
    if (l.unitCost < 0) throw new BadRequestError(`Line ${pos}: the cost cannot be negative`);
    const unitCost = costOf ? await costOf(l.productId) : l.unitCost;
    out.push({ position: pos, productId: l.productId, vin, description: l.description ?? product.name, qty, unitCost, lineTotal: round2(Math.abs(qty) * unitCost), batchNo: l.batchNo ?? null, data: data as Prisma.InputJsonValue });
  }
  return out;
}

async function checkHeader(db: Db, ctx: AccessContext, type: InvDocType, d: ReturnType<typeof docSchema.parse>) {
  const cfg = INV_DOCS[type];
  // references must be visible to the caller AND of the document's brand (DB triggers enforce the brand again)
  if (d.vendorId) {
    const v = await db.vendor.findUnique({ where: { id: d.vendorId }, select: { brandId: true } });
    if (v?.brandId !== d.brandId) throw new BadRequestError("The vendor does not belong to this brand");
  }
  for (const [key, label] of [["warehouseId", "The warehouse"], ["toWarehouseId", "The destination warehouse"]] as const) {
    const id = d[key];
    if (!id || (key === "toWarehouseId" && type === "INTER_BRAND")) continue;
    const w = await db.warehouse.findUnique({ where: { id }, select: { brandId: true } });
    if (w?.brandId !== d.brandId) throw new BadRequestError(`${label} does not belong to this brand`);
  }
  if (d.parentId) {
    const p = await db.inventoryDocument.findUnique({ where: { id: d.parentId }, select: { brandId: true, type: true } });
    if (!p || p.brandId !== d.brandId || !(cfg.parentTypes ?? []).includes(p.type as InvDocType)) throw new BadRequestError("The source document does not fit this document");
  }
  if (type === "INTER_BRAND") {
    if (!d.toBrandId || d.toBrandId === d.brandId) throw new BadRequestError("Choose the receiving brand");
    if (!(await posting.brandExists(d.toBrandId))) throw new BadRequestError("Unknown receiving brand");
  }
}

export async function createInvDocument(ctx: AccessContext, type: string, input: unknown) {
  if (!isDocType(type)) throw new BadRequestError("Unknown document type");
  const cfg = INV_DOCS[type];
  if (cfg.system) throw new BadRequestError(`${cfg.plural} are created by the system`);
  const d = docSchema.parse(input);
  assertBrand(ctx, cfg.area, "create", d.brandId);
  const db = scopedDb(ctx);
  await checkHeader(db, ctx, type, d);
  // without cost access the prices are the system's (in NGN), not the caller's
  const blind = !hasPermission(ctx, "inventoryFinance", "read");
  if (blind) Object.assign(d, { currency: "NGN", exchangeRate: 1 });
  const lines = await buildLines(db, type, d.brandId, d.lines, blind ? await trustedCosts(db, d.brandId, d.parentId) : null);
  const total = round2(lines.reduce((s, l) => s + Number(l.lineTotal ?? 0), 0));
  const doc = await db.inventoryDocument.create({
    data: { brandId: d.brandId, type, status: cfg.initialStatus, vendorId: d.vendorId ?? null, warehouseId: d.warehouseId ?? null, toWarehouseId: type === "INTER_BRAND" ? null : (d.toWarehouseId ?? null), toBrandId: type === "INTER_BRAND" ? d.toBrandId! : null, parentId: d.parentId ?? null, currency: d.currency, exchangeRate: d.currency === "NGN" ? 1 : d.exchangeRate, docDate: d.docDate ?? new Date(), expectedDate: d.expectedDate ?? null, reference: d.reference ?? null, notes: d.notes ?? null, data: d.data as Prisma.InputJsonValue, total, createdById: ctx.userId || null },
  });
  if (lines.length) await db.inventoryDocumentLine.createMany({ data: lines.map((l) => ({ ...l, documentId: doc.id })) });
  await audit({ ctx, action: "CREATE", entity: "InventoryDocument", entityId: doc.id, brandId: d.brandId, after: { type, number: doc.number, total, lines: lines.length } });
  return { id: doc.id, number: doc.number };
}

async function loadForWrite(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const doc = await db.inventoryDocument.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!doc) throw new NotFoundError();
  const cfg = INV_DOCS[doc.type as InvDocType];
  return { db, doc, cfg };
}

/** Changes a document that has not been posted yet (its first status). */
export async function updateInvDocument(ctx: AccessContext, id: string, input: unknown) {
  const { db, doc, cfg } = await loadForWrite(ctx, id);
  assertBrand(ctx, cfg.area, "edit", doc.brandId);
  if (cfg.system || doc.status !== cfg.initialStatus) throw new BadRequestError("Only documents that are not posted yet can be changed");
  const d = docSchema.parse({ ...(input as object), brandId: doc.brandId });
  await checkHeader(db, ctx, cfg.type, d);
  const blind = !hasPermission(ctx, "inventoryFinance", "read");
  if (blind) Object.assign(d, { currency: "NGN", exchangeRate: 1 });
  const lines = await buildLines(db, cfg.type, doc.brandId, d.lines, blind ? await trustedCosts(db, doc.brandId, d.parentId) : null);
  const total = round2(lines.reduce((s, l) => s + Number(l.lineTotal ?? 0), 0));
  await db.inventoryDocumentLine.deleteMany({ where: { documentId: id } });
  if (lines.length) await db.inventoryDocumentLine.createMany({ data: lines.map((l) => ({ ...l, documentId: id })) });
  await db.inventoryDocument.update({ where: { id }, data: { vendorId: d.vendorId ?? null, warehouseId: d.warehouseId ?? null, toWarehouseId: cfg.type === "INTER_BRAND" ? doc.toWarehouseId : (d.toWarehouseId ?? null), toBrandId: cfg.type === "INTER_BRAND" ? d.toBrandId! : null, parentId: d.parentId ?? null, currency: d.currency, exchangeRate: d.currency === "NGN" ? 1 : d.exchangeRate, docDate: d.docDate ?? doc.docDate, expectedDate: d.expectedDate ?? null, reference: d.reference ?? null, notes: d.notes ?? null, data: { ...json(doc.data), ...d.data } as Prisma.InputJsonValue, total, updatedById: ctx.userId || null } });
  await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId: doc.brandId, before: { total: num(doc.total), lines: doc.lines.length }, after: { total, lines: lines.length } });
}

// ───────────────────────────── documents: workflow ─────────────────────────────

const SHIPMENT_FLOW = ["ORDERED", "SHIPPED", "AT_PORT", "CLEARING", "CLEARED", "DELIVERED"] as const;
const SHIPMENT_UNIT_STATUS: Record<string, VehicleStatus | null> = { SHIPPED: "IN_TRANSIT", AT_PORT: "AT_PORT", CLEARING: "IN_CLEARING", CLEARED: "IN_CLEARING", DELIVERED: null };

/** Actions a status offers (the UI shows these buttons; `transition` enforces them again). */
export function availableActions(type: InvDocType, status: string): string[] {
  const map: Partial<Record<InvDocType, Record<string, string[]>>> = {
    // prompt 25: Created → (Pending Approval →) Approved → Sent to Vendor → received by GRN → Closed; cancel from Created / Approved
    PO: { DRAFT: ["submit", "cancel"], PENDING_APPROVAL: ["approve", "reject"], ISSUED: ["send", "reopen", "cancel", "close"], SENT: ["close"], PARTIALLY_RECEIVED: ["close"] },
    SHIPMENT: { ORDERED: ["advance"], SHIPPED: ["advance"], AT_PORT: ["advance"], CLEARING: ["advance"], CLEARED: ["advance"] },
    GRN: { DRAFT: ["receive"] },
    BILL: { DRAFT: ["open", "void"], OPEN: ["pay"], PARTIALLY_PAID: ["pay"] },
    LANDED_COST: { DRAFT: ["allocate"] },
    TRANSFER: { DRAFT: ["ship"], IN_TRANSIT: ["receive"] },
    INTER_BRAND: { DRAFT: ["submit"], PENDING_APPROVAL: ["approve", "reject"], APPROVED: ["ship"] },
    ADJUSTMENT: { DRAFT: ["post"], PENDING_APPROVAL: ["approve", "reject"] },
    STOCK_COUNT: { PLANNED: ["start"], COUNTING: ["reconcile"] },
    VENDOR_CREDIT: { DRAFT: ["open"], OPEN: ["apply"] },
  };
  return map[type]?.[status] ?? [];
}

export const ACTION_LABELS: Record<string, string> = { send: "Send to vendor", reopen: "Reopen", submit: "Submit", approve: "Approve", reject: "Send back", close: "Close", cancel: "Cancel", advance: "Next stage", receive: "Receive", open: "Open", void: "Void", pay: "Record payment", allocate: "Allocate to vehicles", ship: "Ship", post: "Post adjustment", start: "Start counting", reconcile: "Reconcile", apply: "Mark applied" };

async function brandManager(ctx: AccessContext, brandId: string): Promise<string[]> {
  const brand = await scopedDb(ctx).brand.findUnique({ where: { id: brandId }, select: { brandManagerId: true } });
  return brand?.brandManagerId ? [brand.brandManagerId] : [];
}

export async function transition(ctx: AccessContext, id: string, action: string, payload: Record<string, unknown> = {}) {
  const { db, doc, cfg } = await loadForWrite(ctx, id);
  const type = cfg.type;
  if (!availableActions(type, doc.status).includes(action)) throw new BadRequestError(`A ${cfg.label.toLowerCase()} that is ${doc.status.toLowerCase().replace(/_/g, " ")} cannot be ${action === "advance" ? "advanced" : `${action}ed`.replace("ee", "e")}`);
  const brandId = doc.brandId;
  const setStatus = async (status: string, extra: Prisma.InventoryDocumentUncheckedUpdateInput = {}) => {
    await db.inventoryDocument.update({ where: { id }, data: { status, updatedById: ctx.userId || null, ...extra } });
    await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId, before: { status: doc.status }, after: { status, number: doc.number } });
    return { status };
  };
  const posted = async (out: posting.Posted, unitEvent?: "vehicle.received") => {
    await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId, before: { status: doc.status }, after: { status: out.status, number: doc.number, journals: out.journalIds.length } });
    await announce(out, brandId, unitEvent);
    if (["ADJUSTMENT", "TRANSFER", "VENDOR_CREDIT"].includes(type)) await reorderAlerts(db, brandId, doc.lines.filter((l) => !l.vehicleUnitId && l.productId).map((l) => l.productId!));
    return { status: out.status };
  };
  const settings = await posting.brandSettings(brandId);
  const approveOrReject = async (area: "inventory" | "inventoryFinance", onApprove: () => Promise<{ status: string }>) => {
    assertBrand(ctx, area, "approve", brandId);
    if (action === "reject") {
      const res = await setStatus("DRAFT", { data: { ...json(doc.data), rejectedBy: ctx.user.name, rejectNote: String(payload.note ?? "") } as Prisma.InputJsonValue });
      if (doc.createdById) await notify(ctx, [doc.createdById], { kind: "APPROVAL", title: `${cfg.label} ${doc.number} was sent back`, body: String(payload.note ?? "") || null, href: `/inventory/documents/${id}` });
      return res;
    }
    const res = await onApprove();
    if (doc.createdById && doc.createdById !== ctx.userId) await notify(ctx, [doc.createdById], { kind: "APPROVAL", title: `${cfg.label} ${doc.number} approved`, body: null, href: `/inventory/documents/${id}` });
    return res;
  };

  switch (type) {
    case "PO": {
      if (action === "submit") {
        assertBrand(ctx, "inventory", "edit", brandId);
        if (doc.lines.length === 0) throw new BadRequestError("Add at least one line");
        if (!doc.vendorId) throw new BadRequestError("Choose the vendor");
        const ngn = round2(num(doc.total) * num(doc.exchangeRate));
        if (ngn > num(settings.poApprovalLimit) && !hasPermission(ctx, "inventory", "approve")) {
          const res = await setStatus("PENDING_APPROVAL");
          await notify(ctx, (await brandManager(ctx, brandId)).filter((u) => u !== ctx.userId), { kind: "APPROVAL", title: `Purchase order ${doc.number} needs your approval`, body: `${doc.currency} ${num(doc.total).toLocaleString("en-NG")}`, href: `/inventory/documents/${id}` });
          return res;
        }
        return setStatus("ISSUED");
      }
      if (action === "approve" || action === "reject") return approveOrReject("inventory", () => setStatus("ISSUED", { data: { ...json(doc.data), approvedBy: ctx.user.name } as Prisma.InputJsonValue }));
      if (action === "reopen") {
        // lines and amounts are locked once approved: a Brand Manager / administrator can reopen it (recorded)
        if (!ctx.isAdmin && !managedBrands(ctx).includes(brandId)) throw new ForbiddenError("Only the Brand Manager or an administrator can reopen an approved purchase order");
        if (await db.inventoryDocument.findFirst({ where: { parentId: id }, select: { id: true } })) throw new BadRequestError("Goods are already being shipped or received against this order");
        return setStatus("DRAFT", { data: { ...json(doc.data), reopenedBy: ctx.user.name } as Prisma.InputJsonValue });
      }
      assertBrand(ctx, "inventory", "edit", brandId);
      if (action === "send") {
        const { sendPurchaseOrder } = await import("./po-send");
        const sent = await sendPurchaseOrder(ctx, id);
        return { ...(await setStatus("SENT", { data: { ...json(doc.data), sentTo: sent.to, sentAt: new Date().toISOString() } as Prisma.InputJsonValue })), message: sent.to ? `Sent to ${sent.to}` : "Marked as sent – the vendor has no e-mail address" };
      }
      return setStatus(action === "close" ? "CLOSED" : "CANCELLED");
    }
    case "SHIPMENT": {
      assertBrand(ctx, "inventory", "edit", brandId);
      const next = SHIPMENT_FLOW[SHIPMENT_FLOW.indexOf(doc.status as (typeof SHIPMENT_FLOW)[number]) + 1]!;
      const unitStatus = SHIPMENT_UNIT_STATUS[next];
      if (next === "SHIPPED") {
        // the vessel has sailed: the VINs on the shipment become units in transit
        for (const l of doc.lines) {
          if (!l.vin || !l.productId) continue;
          const vin = normalizeVin(l.vin);
          if (await db.vehicleUnit.findFirst({ where: { brandId, vin }, select: { id: true } })) throw new BadRequestError(`VIN ${vin} already exists for this brand`);
          const unit = await db.vehicleUnit.create({ data: { brandId, productId: l.productId, vin, colour: (json(l.data).colour as string) || null, status: "ON_ORDER", shipmentId: id } });
          await db.inventoryDocumentLine.update({ where: { id: l.id }, data: { vehicleUnitId: unit.id } });
        }
      }
      if (unitStatus) {
        const units = await db.vehicleUnit.findMany({ where: { shipmentId: id, status: { in: ["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING"] } }, select: { id: true, status: true } });
        for (const u of units) {
          if (u.status === unitStatus) continue;
          await posting.changeUnitStatus(u.id, brandId, unitStatus, actor(ctx), `Shipment ${doc.number}: ${next.toLowerCase().replace(/_/g, " ")}`);
          await dispatchEvent("vehicle.status_changed", u.id, brandId);
        }
      }
      return setStatus(next);
    }
    case "GRN":
      assertBrand(ctx, "inventory", "edit", brandId);
      return posted(await posting.postReceipt(id, brandId, actor(ctx)), "vehicle.received");
    case "BILL": {
      assertBrand(ctx, "inventoryFinance", "edit", brandId);
      if (action === "open") return posted(await posting.postBill(id, brandId, actor(ctx)));
      if (action === "void") return setStatus("VOID");
      return posted(await posting.payBill(id, brandId, Number(payload.amount), actor(ctx)));
    }
    case "LANDED_COST":
      // logistics officers enter the voucher (finance create); allocating posts to the books (finance edit)
      assertBrand(ctx, "inventoryFinance", "edit", brandId);
      return posted(await posting.postLandedCost(id, brandId, actor(ctx)));
    case "TRANSFER":
      assertBrand(ctx, "inventory", "edit", brandId);
      return posted(action === "ship" ? await posting.shipTransfer(id, brandId, actor(ctx)) : await posting.receiveTransfer(id, brandId, actor(ctx)));
    case "INTER_BRAND": {
      if (action === "submit") {
        assertBrand(ctx, "inventory", "edit", brandId);
        if (doc.lines.length === 0) throw new BadRequestError("Add at least one vehicle");
        const res = await setStatus("PENDING_APPROVAL", { data: { ...json(doc.data), approvals: {} } as Prisma.InputJsonValue });
        await notify(ctx, [...(await brandManager(ctx, brandId)), ...(await brandManager(ctx, doc.toBrandId!))].filter((u) => u !== ctx.userId), { kind: "APPROVAL", title: `Inter-brand transfer ${doc.number} needs approval`, body: `${doc.lines.length} vehicle(s)`, href: "/inventory/documents?type=INTER_BRAND" });
        return res;
      }
      if (action === "ship") {
        assertBrand(ctx, "inventory", "edit", brandId);
        return posted(await posting.shipInterBrand(id, brandId, actor(ctx)));
      }
      if (action === "reject") {
        assertBrand(ctx, "inventory", "approve", brandId);
        return setStatus("DRAFT");
      }
      return approveInterBrand(ctx, id, "from");
    }
    case "ADJUSTMENT": {
      if (action === "post") {
        assertBrand(ctx, "inventory", "edit", brandId);
        const value = await posting.adjustmentValue(id, brandId);
        if (value > num(settings.adjustmentApprovalLimit) && !hasPermission(ctx, "inventoryFinance", "approve")) return setStatus("PENDING_APPROVAL", { total: value });
        return posted(await posting.postAdjustment(id, brandId, actor(ctx)));
      }
      return approveOrReject("inventoryFinance", async () => posted(await posting.postAdjustment(id, brandId, actor(ctx))));
    }
    case "STOCK_COUNT": {
      assertBrand(ctx, "inventory", "edit", brandId);
      if (!doc.warehouseId) throw new BadRequestError("Choose the warehouse to count");
      if (action === "start") {
        // snapshot of what the books say is in the warehouse
        const [units, balances, products] = await Promise.all([db.vehicleUnit.findMany({ where: { brandId, warehouseId: doc.warehouseId, status: { in: IN_STOCK } }, include: { product: { select: { name: true } } }, orderBy: { vin: "asc" } }), db.stockBalance.findMany({ where: { brandId, warehouseId: doc.warehouseId, qty: { gt: 0 } } }), db.product.findMany({ where: { brandId }, select: { id: true, name: true } })]);
        const name = new Map(products.map((p) => [p.id, p.name]));
        const lines = [...units.map((u) => ({ productId: u.productId, vehicleUnitId: u.id, vin: u.vin, description: u.product.name, qty: 1, data: { counted: false } })), ...balances.filter((b) => !units.some((u) => u.productId === b.productId)).map((b) => ({ productId: b.productId, description: name.get(b.productId) ?? "Item", qty: num(b.qty), batchNo: b.batchNo || null, data: { counted: null } }))];
        await db.inventoryDocumentLine.deleteMany({ where: { documentId: id } });
        if (lines.length) await db.inventoryDocumentLine.createMany({ data: lines.map((l, i) => ({ ...l, documentId: id, position: i + 1 })) });
        return setStatus("COUNTING");
      }
      return reconcileCount(ctx, id);
    }
    case "VENDOR_CREDIT":
      assertBrand(ctx, "inventoryFinance", "edit", brandId);
      return action === "open" ? posted(await posting.postVendorCredit(id, brandId, actor(ctx))) : setStatus("APPLIED");
    default:
      throw new BadRequestError("Nothing to do");
  }
}

/** Parts that an issue brought to or below their reorder level raise `stock.below_reorder`. */
async function reorderAlerts(db: Db, brandId: string, productIds: string[]) {
  for (const productId of [...new Set(productIds)]) {
    const product = await db.product.findUnique({ where: { id: productId }, select: { reorderLevel: true } });
    if (!product || product.reorderLevel === null) continue;
    const onHand = await db.stockBalance.aggregate({ where: { brandId, productId }, _sum: { qty: true } });
    if (num(onHand._sum.qty) <= num(product.reorderLevel)) await dispatchEvent("stock.below_reorder", productId, brandId);
  }
}

// ───────────────────────────── inter-brand approvals ─────────────────────────────

const SLOTS = ["fromManager", "fromFinance", "toManager", "toFinance"] as const;
export const SLOT_LABELS: Record<(typeof SLOTS)[number], string> = { fromManager: "Brand Manager (sending brand)", fromFinance: "Brand Accountant (sending brand)", toManager: "Brand Manager (receiving brand)", toFinance: "Brand Accountant (receiving brand)" };

/**
 * An inter-brand transfer is a sale between two legal entities: it needs the Brand Manager and the Brand
 * Accountant of BOTH brands. A user fills the slots their role covers on their side; administrators fill any.
 */
export async function approveInterBrand(ctx: AccessContext, id: string, side: "from" | "to") {
  const incoming = side === "to" ? (await posting.incomingInterBrand(ctx.scope === "ALL" ? await allBrandIds(ctx) : ctx.brandIds)).find((d) => d.id === id) : null;
  const own = side === "from" ? await scopedDb(ctx).inventoryDocument.findUnique({ where: { id } }) : null;
  const doc = side === "from" ? (own ? { status: own.status, brandId: own.brandId, toBrandId: own.toBrandId!, data: json(own.data), number: own.number } : null) : incoming ? { status: incoming.status, brandId: incoming.fromBrandId, toBrandId: incoming.toBrandId, data: incoming.data, number: incoming.number } : null;
  if (!doc) throw new NotFoundError();
  if (doc.status !== "PENDING_APPROVAL") throw new BadRequestError("This transfer is not waiting for approval");
  const brand = side === "from" ? doc.brandId : doc.toBrandId;
  const inBrand = ctx.scope === "ALL" || ctx.brandIds.includes(brand);
  const manager = ctx.isAdmin || (managedBrands(ctx).includes(brand) && hasPermission(ctx, "inventory", "approve"));
  const finance = ctx.isAdmin || (inBrand && hasPermission(ctx, "inventoryFinance", "approve") && hasPermission(ctx, "inventoryFinance", "edit"));
  if (!manager && !finance) throw new ForbiddenError("Only the Brand Manager or the Brand Accountant of this brand can approve the transfer");
  const approvals = { ...json(doc.data.approvals) } as Record<string, { userId: string; name: string; at: string }>;
  const stamp = { userId: ctx.userId, name: ctx.user.name, at: new Date().toISOString() };
  if (manager) approvals[`${side}Manager`] ??= stamp;
  if (finance) approvals[`${side}Finance`] ??= stamp;
  const complete = SLOTS.every((s) => approvals[s]);
  await posting.patchInterBrandAny(id, { data: { approvals }, ...(complete ? { status: "APPROVED" } : {}) });
  await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId: brand, after: { number: doc.number, approvedAs: [manager ? `${side}Manager` : null, finance ? `${side}Finance` : null].filter(Boolean), status: complete ? "APPROVED" : "PENDING_APPROVAL" } });
  return { status: complete ? "APPROVED" : "PENDING_APPROVAL", missing: SLOTS.filter((s) => !approvals[s]).map((s) => SLOT_LABELS[s]) };
}

async function allBrandIds(ctx: AccessContext) {
  return (await scopedDb(ctx).brand.findMany({ select: { id: true } })).map((b) => b.id);
}

/** The receiving brand takes the shipped units into one of ITS warehouses as its own items. */
export async function receiveInterBrand(ctx: AccessContext, id: string, input: { toWarehouseId?: string; lineProducts?: Record<string, string> }) {
  const incoming = (await posting.incomingInterBrand(ctx.scope === "ALL" ? await allBrandIds(ctx) : ctx.brandIds)).find((d) => d.id === id);
  if (!incoming) throw new NotFoundError();
  assertBrand(ctx, "inventory", "edit", incoming.toBrandId);
  const db = scopedDb(ctx);
  const warehouse = input.toWarehouseId ? await db.warehouse.findUnique({ where: { id: input.toWarehouseId }, select: { brandId: true } }) : null;
  if (warehouse?.brandId !== incoming.toBrandId) throw new BadRequestError("Choose a warehouse of the receiving brand");
  await posting.patchInterBrand(id, incoming.toBrandId, { toWarehouseId: input.toWarehouseId, lineProducts: input.lineProducts ?? {} });
  const out = await posting.receiveInterBrand(id, incoming.toBrandId, actor(ctx));
  await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId: incoming.toBrandId, after: { number: incoming.number, status: "RECEIVED" } });
  await announce(out, incoming.toBrandId, "vehicle.received");
  return { status: out.status };
}

// ───────────────────────────── stock count ─────────────────────────────

/** Records counted VINs (scanned or typed) and counted quantities on a count that is in progress. */
export async function recordCount(ctx: AccessContext, id: string, input: { vins?: string[]; counts?: Record<string, number | string> }) {
  const { db, doc } = await loadForWrite(ctx, id);
  assertBrand(ctx, "inventory", "edit", doc.brandId);
  if (doc.type !== "STOCK_COUNT" || doc.status !== "COUNTING") throw new BadRequestError("This count is not in progress");
  const data = json(doc.data);
  const unexpected = new Set<string>(Array.isArray(data.unexpected) ? (data.unexpected as string[]) : []);
  let matched = 0;
  for (const raw of input.vins ?? []) {
    const vin = normalizeVin(raw);
    if (!vin) continue;
    const line = doc.lines.find((l) => l.vin === vin);
    if (line) {
      await db.inventoryDocumentLine.update({ where: { id: line.id }, data: { data: { ...json(line.data), counted: true } } });
      matched++;
    } else unexpected.add(vin);
  }
  for (const [lineId, qty] of Object.entries(input.counts ?? {})) {
    const line = doc.lines.find((l) => l.id === lineId && !l.vehicleUnitId);
    if (line && qty !== "" && Number.isFinite(Number(qty))) await db.inventoryDocumentLine.update({ where: { id: lineId }, data: { data: { ...json(line.data), counted: Number(qty) } } });
  }
  await db.inventoryDocument.update({ where: { id }, data: { data: { ...data, unexpected: [...unexpected] } as Prisma.InputJsonValue } });
  return { matched, unexpected: [...unexpected] };
}

/** Closes the count; variances become a DRAFT adjustment for review (missing vehicles as write-offs). */
async function reconcileCount(ctx: AccessContext, id: string) {
  const { db, doc } = await loadForWrite(ctx, id);
  const lines: Array<Record<string, unknown>> = [];
  for (const l of doc.lines) {
    const counted = json(l.data).counted;
    if (l.vehicleUnitId) {
      if (counted !== true) lines.push({ vehicleUnitId: l.vehicleUnitId, data: { action: "WRITE_OFF" } });
    } else if (typeof counted === "number" && Math.abs(counted - num(l.qty)) > 1e-9 && l.productId) {
      const product = await db.product.findUnique({ where: { id: l.productId }, select: { costPrice: true } });
      lines.push({ productId: l.productId, qty: counted - num(l.qty), unitCost: num(product?.costPrice), batchNo: l.batchNo });
    }
  }
  let adjustmentId: string | null = null;
  if (lines.length) adjustmentId = (await createInvDocument(ctx, "ADJUSTMENT", { brandId: doc.brandId, warehouseId: doc.warehouseId, reference: "Count variance", notes: `From stock count ${doc.number}`, data: { stockCountId: id }, lines })).id;
  await db.inventoryDocument.update({ where: { id }, data: { status: "RECONCILED", data: { ...json(doc.data), variances: lines.length, adjustmentId } as Prisma.InputJsonValue, updatedById: ctx.userId || null } });
  await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: id, brandId: doc.brandId, after: { number: doc.number, status: "RECONCILED", variances: lines.length } });
  return { status: "RECONCILED", adjustmentId };
}

// ───────────────────────────── unit operations ─────────────────────────────

async function loadUnit(ctx: AccessContext, id: string) {
  const db = scopedDb(ctx);
  const unit = await db.vehicleUnit.findUnique({ where: { id } });
  if (!unit) throw new NotFoundError();
  return { db, unit };
}

/** Starts the pre-delivery inspection of a received unit with the brand's checklist. */
export async function startPdi(ctx: AccessContext, unitId: string) {
  const { db, unit } = await loadUnit(ctx, unitId);
  assertBrand(ctx, "inventory", "edit", unit.brandId);
  if (unit.status !== "PDI_PENDING") throw new BadRequestError("Only units waiting for PDI can be inspected");
  const open = await db.inventoryDocument.findFirst({ where: { brandId: unit.brandId, type: "PDI", status: "PENDING", lines: { some: { vehicleUnitId: unitId } } }, select: { id: true } });
  if (open) return { id: open.id };
  const settings = await posting.brandSettings(unit.brandId);
  const template = settings.pdiTemplate.length ? settings.pdiTemplate : DEFAULT_PDI;
  const doc = await db.inventoryDocument.create({ data: { brandId: unit.brandId, type: "PDI", status: "PENDING", warehouseId: unit.warehouseId, data: { checklist: template.map((item) => ({ item, ok: null })) }, createdById: ctx.userId || null } });
  await db.inventoryDocumentLine.create({ data: { documentId: doc.id, position: 1, productId: unit.productId, vehicleUnitId: unit.id, vin: unit.vin, description: "Pre-delivery inspection", qty: 1 } });
  return { id: doc.id };
}

/** Pass (every item OK) makes the unit available for sale; a failed item puts it on hold. */
export async function completePdi(ctx: AccessContext, docId: string, input: { results: Record<string, boolean>; notes?: string | null }) {
  const { db, doc } = await loadForWrite(ctx, docId);
  assertBrand(ctx, "inventory", "edit", doc.brandId);
  if (doc.type !== "PDI" || doc.status !== "PENDING") throw new BadRequestError("This inspection is already completed");
  const checklist = (Array.isArray(json(doc.data).checklist) ? (json(doc.data).checklist as Array<{ item: string }>) : []).map((c) => ({ item: c.item, ok: input.results[c.item] === true }));
  const passed = checklist.length > 0 && checklist.every((c) => c.ok);
  const unitId = doc.lines[0]?.vehicleUnitId;
  if (!unitId) throw new BadRequestError("The inspection has no vehicle");
  await posting.changeUnitStatus(unitId, doc.brandId, passed ? "AVAILABLE" : "ON_HOLD", actor(ctx), passed ? `PDI passed (${doc.number})` : `PDI failed (${doc.number}): ${checklist.filter((c) => !c.ok).map((c) => c.item).join(", ")}`, passed ? { pdiPassedAt: new Date() } : { damageNotes: input.notes ?? null });
  await db.inventoryDocument.update({ where: { id: docId }, data: { status: passed ? "PASSED" : "FAILED", notes: input.notes ?? null, postedAt: new Date(), data: { checklist, inspectedBy: ctx.user.name } as Prisma.InputJsonValue, updatedById: ctx.userId || null } });
  await audit({ ctx, action: "UPDATE", entity: "InventoryDocument", entityId: docId, brandId: doc.brandId, after: { number: doc.number, status: passed ? "PASSED" : "FAILED" } });
  await dispatchEvent("vehicle.status_changed", unitId, doc.brandId);
  return { passed };
}

/** Demo / test-drive fleet: an available unit joins the fleet, or comes back to sellable stock. */
export async function setDemo(ctx: AccessContext, unitId: string, on: boolean, mileage?: number | null) {
  const { unit } = await loadUnit(ctx, unitId);
  assertBrand(ctx, "inventory", "edit", unit.brandId);
  if (on && unit.status !== "AVAILABLE") throw new BadRequestError("Only available units can join the demo fleet");
  if (!on && unit.status !== "DEMO") throw new BadRequestError("This unit is not in the demo fleet");
  await posting.changeUnitStatus(unitId, unit.brandId, on ? "DEMO" : "AVAILABLE", actor(ctx), on ? "Moved to the demo fleet" : "Back to sellable stock", { isDemo: on, ...(mileage !== undefined && mileage !== null ? { mileage } : {}) });
  await audit({ ctx, action: "UPDATE", entity: "VehicleUnit", entityId: unitId, brandId: unit.brandId, before: { status: unit.status }, after: { status: on ? "DEMO" : "AVAILABLE", mileage } });
  await dispatchEvent("vehicle.status_changed", unitId, unit.brandId);
}

/** Descriptive fields of a unit. Status, warehouse and cost only change through documents. */
export async function updateUnit(ctx: AccessContext, unitId: string, input: Record<string, unknown>) {
  const { db, unit } = await loadUnit(ctx, unitId);
  assertBrand(ctx, "inventory", "edit", unit.brandId);
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim().slice(0, 200) || null : undefined);
  const n = (k: string) => (input[k] === "" || input[k] === null || input[k] === undefined ? undefined : Number(input[k]));
  const data: Prisma.VehicleUnitUncheckedUpdateInput = { engineNo: s("engineNo"), colour: s("colour"), colourInterior: s("colourInterior"), keyNo: s("keyNo"), plateNo: s("plateNo"), customsDocNo: s("customsDocNo"), damageNotes: s("damageNotes"), ...(input.importDutyPaid !== undefined ? { importDutyPaid: input.importDutyPaid === true || input.importDutyPaid === "on" } : {}), ...(n("mileage") !== undefined ? { mileage: Math.max(0, Math.floor(n("mileage")!)) } : {}), ...(n("sellingPrice") !== undefined ? { sellingPrice: n("sellingPrice") } : {}), ...(n("modelYear") !== undefined ? { modelYear: n("modelYear") } : {}) };
  await db.vehicleUnit.update({ where: { id: unitId }, data });
  await audit({ ctx, action: "UPDATE", entity: "VehicleUnit", entityId: unitId, brandId: unit.brandId, after: data });
}

/** The Brand Manager extends a reservation that is about to expire. */
export async function extendReservation(ctx: AccessContext, unitId: string, days: number) {
  const { unit } = await loadUnit(ctx, unitId);
  assertBrand(ctx, "inventory", "approve", unit.brandId);
  if (unit.status !== "RESERVED") throw new BadRequestError("This unit is not reserved");
  if (!(days >= 1 && days <= 90)) throw new BadRequestError("Extend by 1 to 90 days");
  const until = new Date(Math.max(Date.now(), unit.reservedUntil?.getTime() ?? 0) + days * 86_400_000);
  await posting.extendReservation(unitId, unit.brandId, until);
  await audit({ ctx, action: "UPDATE", entity: "VehicleUnit", entityId: unitId, brandId: unit.brandId, before: { reservedUntil: unit.reservedUntil }, after: { reservedUntil: until } });
  return { until };
}

/** Scheduler: expired reservations go back to stock; the executive who held one is told. */
export async function expireReservations(now = new Date()): Promise<number> {
  const released = await posting.releaseExpiredReservations(now);
  for (const r of released) await dispatchEvent("vehicle.status_changed", r.id, r.brandId);
  return released.length;
}
