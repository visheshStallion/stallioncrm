/**
 * Inventory reads (prompt 16). Three layers decide what a user sees:
 *   1. brand – every query goes through `scopedDb` (brand-tagged models) and RLS: other brands do not exist;
 *   2. role – users without stock-keeping rights (sales executives, RSMs) get the SALES VIEW: available units
 *      of their brands plus the units of deals they can see, the VIN masked until a unit is theirs;
 *   3. cost tier – purchase cost, landed cost, valuation, margins and journals need `inventoryFinance.read`;
 *      for everyone else the cost fields are not in the result at all.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { brandTagWhere } from "@/server/access/brand-tag";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { incomingInterBrand } from "@/server/db/inventory-posting";
import { INV_DOCS, type InvDocType } from "./config";
import { round2 } from "./costing";
import { AGEING_BUCKETS, IN_STOCK, PIPELINE, STATUS_LABELS, VEHICLE_STATUSES, ageingBucket, ageingDays, type VehicleStatus } from "./status";
import { maskVin, normalizeVin } from "./vin";

const num = (d: { toString(): string } | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));

export const canSeeCost = (ctx: AccessContext) => hasPermission(ctx, "inventoryFinance", "read");
/** No stock-keeping rights: sees what can be sold, not the warehouse's books. */
export const isSalesView = (ctx: AccessContext) => !hasPermission(ctx, "inventory", "edit") && !hasPermission(ctx, "inventory", "approve") && !canSeeCost(ctx);

export function assertFinance(ctx: AccessContext) {
  if (!canSeeCost(ctx)) throw new ForbiddenError("You do not have access to inventory cost data");
}

/** Brand filter of the UI, narrowed to the user's brands. */
const brandWhere = (ctx: AccessContext, brandId?: string | null) => ({ AND: [brandTagWhere(ctx), brandId ? { brandId } : {}] });

// ───────────────────────────── vehicle units ─────────────────────────────

export interface UnitRow {
  id: string;
  brandId: string;
  productId: string;
  productName: string;
  vin: string;
  colour: string | null;
  modelYear: number | null;
  warehouseId: string | null;
  warehouseName: string | null;
  status: VehicleStatus;
  statusLabel: string;
  ageDays: number | null;
  ageBucket: string | null;
  dealId: string | null;
  reservedUntil: string | null;
  isDemo: boolean;
  sellingPrice: number | null;
  /** cost tier – present only for users with inventory finance access */
  purchaseCost?: number;
  landedCost?: number;
  totalCost?: number;
}

const unitInclude = { product: { select: { name: true, listPrice: true } }, warehouse: { select: { name: true } } } as const;
type UnitRecord = Prisma.VehicleUnitGetPayload<{ include: typeof unitInclude }>;

function toUnitRow(ctx: AccessContext, u: UnitRecord, visibleDeals: Set<string> | null, now: Date): UnitRow {
  const days = IN_STOCK.includes(u.status as VehicleStatus) ? ageingDays(u.receivedAt, now) : null;
  const mine = !visibleDeals || (u.dealId !== null && visibleDeals.has(u.dealId));
  const row: UnitRow = {
    id: u.id,
    brandId: u.brandId,
    productId: u.productId,
    productName: u.product.name,
    vin: mine ? u.vin : maskVin(u.vin),
    colour: u.colour,
    modelYear: u.modelYear,
    warehouseId: u.warehouseId,
    warehouseName: u.warehouse?.name ?? null,
    status: u.status as VehicleStatus,
    statusLabel: STATUS_LABELS[u.status as VehicleStatus],
    ageDays: days,
    ageBucket: ageingBucket(days),
    dealId: mine ? u.dealId : null,
    reservedUntil: u.reservedUntil?.toISOString() ?? null,
    isDemo: u.isDemo,
    sellingPrice: u.sellingPrice !== null ? num(u.sellingPrice) : u.product.listPrice !== null ? num(u.product.listPrice) : null,
  };
  if (canSeeCost(ctx)) {
    row.purchaseCost = num(u.purchaseCost);
    row.landedCost = num(u.landedCost);
    row.totalCost = round2(num(u.purchaseCost) + num(u.landedCost));
  }
  return row;
}

/** Deals the caller can see that hold a unit – the sales view shows those units in full. */
async function visibleDealIds(ctx: AccessContext, dealIds: Array<string | null>): Promise<Set<string>> {
  const ids = [...new Set(dealIds.filter((d): d is string => !!d))];
  if (ids.length === 0 || !hasPermission(ctx, "deals", "read")) return new Set();
  return new Set((await scopedDb(ctx).deal.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((d) => d.id));
}

export interface UnitFilters {
  brandId?: string | null;
  productId?: string;
  warehouseId?: string;
  status?: string;
  colour?: string;
  year?: string;
  ageing?: string;
  q?: string;
  /** "available": what can be sold now */
  view?: string;
}

function ageingWhere(bucket: string | undefined, now: Date): Prisma.VehicleUnitWhereInput {
  const i = AGEING_BUCKETS.findIndex((b) => b.key === bucket);
  if (i < 0) return {};
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const min = i === 0 ? 0 : AGEING_BUCKETS[i - 1]!.max + 1;
  const max = AGEING_BUCKETS[i]!.max;
  return { status: { in: IN_STOCK }, receivedAt: { lte: day(min), ...(Number.isFinite(max) ? { gt: day(max + 1) } : {}) } };
}

export async function listUnits(ctx: AccessContext, f: UnitFilters = {}, opts: { take?: number; skip?: number } = {}): Promise<{ rows: UnitRow[]; total: number; salesView: boolean }> {
  assertCan(ctx, "inventory", "read");
  const db = scopedDb(ctx);
  const now = new Date();
  const sales = isSalesView(ctx);
  const q = f.q?.trim();
  const status = (VEHICLE_STATUSES as readonly string[]).includes(f.status ?? "") ? (f.status as VehicleStatus) : undefined;
  // The sales view never matches on the hidden part of a VIN: searching is by the last six characters only.
  const vinSearch: Prisma.VehicleUnitWhereInput = q ? (sales ? { vin: { endsWith: normalizeVin(q).slice(-6), mode: "insensitive" } } : { OR: [{ vin: { contains: normalizeVin(q), mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }, { plateNo: { contains: q, mode: "insensitive" } }] }) : {};
  let scope: Prisma.VehicleUnitWhereInput = {};
  if (sales) {
    const mine = hasPermission(ctx, "deals", "read") ? (await db.deal.findMany({ where: { vinChassisNo: { not: null } }, select: { id: true }, take: 2000 })).map((d) => d.id) : [];
    scope = f.view === "mine" ? { dealId: { in: mine } } : { OR: [{ status: "AVAILABLE" }, { dealId: { in: mine } }] };
  } else if (f.view === "available") scope = { status: "AVAILABLE" };
  const where: Prisma.VehicleUnitWhereInput = {
    AND: [
      brandWhere(ctx, f.brandId),
      scope,
      status ? { status } : {},
      f.productId ? { productId: f.productId } : {},
      f.warehouseId ? { warehouseId: f.warehouseId } : {},
      f.colour ? { colour: { equals: f.colour, mode: "insensitive" } } : {},
      f.year && Number(f.year) ? { modelYear: Number(f.year) } : {},
      ageingWhere(f.ageing, now),
      vinSearch,
    ],
  };
  const [rows, total] = await Promise.all([db.vehicleUnit.findMany({ where, include: unitInclude, orderBy: [{ status: "asc" }, { receivedAt: "asc" }, { vin: "asc" }], take: Math.min(opts.take ?? 50, 500), skip: opts.skip ?? 0 }), db.vehicleUnit.count({ where })]);
  const deals = sales ? await visibleDealIds(ctx, rows.map((r) => r.dealId)) : null;
  return { rows: rows.map((u) => toUnitRow(ctx, u, deals, now)), total, salesView: sales };
}

export interface UnitDetail extends UnitRow {
  engineNo: string | null;
  colourInterior: string | null;
  keyNo: string | null;
  plateNo: string | null;
  customsDocNo: string | null;
  importDutyPaid: boolean;
  mileage: number | null;
  damageNotes: string | null;
  receivedAt: string | null;
  pdiPassedAt: string | null;
  soldAt: string | null;
  deliveredAt: string | null;
  salesOrderId: string | null;
  invoiceId: string | null;
  history: Array<{ id: string; from: string | null; to: string; note: string | null; at: string; userName: string | null }>;
  movements: Array<{ id: string; at: string; movementType: string; warehouseName: string; qtyIn: number; qtyOut: number; sourceDocType: string | null; sourceDocId: string | null; totalCost?: number }>;
}

/** 404 for units of other brands – and, in the sales view, for units that are neither available nor the caller's. */
export async function getUnit(ctx: AccessContext, id: string): Promise<UnitDetail> {
  assertCan(ctx, "inventory", "read");
  const db = scopedDb(ctx);
  const u = await db.vehicleUnit.findUnique({ where: { id }, include: unitInclude });
  if (!u) throw new NotFoundError();
  const sales = isSalesView(ctx);
  const deals = sales ? await visibleDealIds(ctx, [u.dealId]) : null;
  if (sales && u.status !== "AVAILABLE" && !(u.dealId && deals!.has(u.dealId))) throw new NotFoundError();
  const [history, movements, users, warehouses] = await Promise.all([
    sales ? [] : db.vehicleStatusHistory.findMany({ where: { unitId: id }, orderBy: { at: "desc" }, take: 100 }),
    sales ? [] : db.stockMovement.findMany({ where: { vehicleUnitId: id }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100 }),
    db.user.findMany({ select: { id: true, name: true } }),
    db.warehouse.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((x) => [x.id, x.name]));
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const cost = canSeeCost(ctx);
  const mine = !sales || (u.dealId !== null && deals!.has(u.dealId));
  return {
    ...toUnitRow(ctx, u, deals, new Date()),
    engineNo: mine ? u.engineNo : null,
    colourInterior: u.colourInterior,
    keyNo: sales ? null : u.keyNo,
    plateNo: u.plateNo,
    customsDocNo: sales ? null : u.customsDocNo,
    importDutyPaid: u.importDutyPaid,
    mileage: u.mileage,
    damageNotes: sales ? null : u.damageNotes,
    receivedAt: u.receivedAt?.toISOString() ?? null,
    pdiPassedAt: u.pdiPassedAt?.toISOString() ?? null,
    soldAt: u.soldAt?.toISOString() ?? null,
    deliveredAt: u.deliveredAt?.toISOString() ?? null,
    salesOrderId: mine ? u.salesOrderId : null,
    invoiceId: mine ? u.invoiceId : null,
    history: history.map((h) => ({ id: h.id, from: h.from, to: h.to, note: h.note, at: h.at.toISOString(), userName: h.userId ? (userName.get(h.userId) ?? null) : null })),
    movements: movements.map((m) => ({ id: m.id, at: m.at.toISOString(), movementType: m.movementType, warehouseName: whName.get(m.warehouseId) ?? "—", qtyIn: num(m.qtyIn), qtyOut: num(m.qtyOut), sourceDocType: m.sourceDocType, sourceDocId: m.sourceDocId, ...(cost ? { totalCost: num(m.totalCost) } : {}) })),
  };
}

/** Scanner lookup by VIN: the caller's brands only – another brand's VIN is "not found". */
export async function lookupVin(ctx: AccessContext, raw: string): Promise<UnitDetail> {
  assertCan(ctx, "inventory", "read");
  const vin = normalizeVin(raw);
  if (vin.length < 6) throw new NotFoundError();
  const hit = await scopedDb(ctx).vehicleUnit.findFirst({ where: { AND: [brandTagWhere(ctx), { vin }] }, select: { id: true } });
  if (!hit) throw new NotFoundError();
  return getUnit(ctx, hit.id);
}

// ───────────────────────────── master data ─────────────────────────────

export async function listWarehouses(ctx: AccessContext, brandId?: string | null) {
  assertCan(ctx, "inventory", "read");
  return scopedDb(ctx).warehouse.findMany({ where: brandWhere(ctx, brandId), orderBy: [{ brandId: "asc" }, { name: "asc" }] });
}

/** Vendors of the caller's brands. Bank details are finance-only. */
export async function listVendors(ctx: AccessContext, brandId?: string | null) {
  assertCan(ctx, "inventory", "read");
  if (isSalesView(ctx)) throw new ForbiddenError("You do not have access to vendors");
  const rows = await scopedDb(ctx).vendor.findMany({ where: brandWhere(ctx, brandId), orderBy: [{ brandId: "asc" }, { name: "asc" }] });
  return canSeeCost(ctx) ? rows : rows.map((v) => ({ ...v, bankDetails: null, taxId: null }));
}

export async function getSettings(ctx: AccessContext, brandId: string) {
  assertCan(ctx, "inventory", "read");
  if (ctx.scope !== "ALL" && !ctx.brandIds.includes(brandId)) throw new NotFoundError();
  return (await import("@/server/db/inventory-posting")).brandSettings(brandId);
}

// ───────────────────────────── parts & accessories ─────────────────────────────

export interface StockRow {
  brandId: string;
  productId: string;
  code: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  batchNo: string;
  qty: number;
  reorderLevel: number | null;
  reorderQty: number | null;
  belowReorder: boolean;
  value?: number;
}

/** Quantity stock of non-serial items per warehouse / batch, with reorder flags (per item across warehouses). */
export async function listStockBalances(ctx: AccessContext, f: { brandId?: string | null; warehouseId?: string; reorderOnly?: boolean } = {}): Promise<StockRow[]> {
  assertCan(ctx, "inventory", "read");
  if (isSalesView(ctx)) throw new ForbiddenError("You do not have access to parts stock");
  const db = scopedDb(ctx);
  const products = await db.product.findMany({ where: { AND: [brandWhere(ctx, f.brandId), { trackingType: { not: "SERIAL" } }] }, select: { id: true, brandId: true, code: true, name: true, reorderLevel: true, reorderQty: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const [balances, warehouses] = await Promise.all([db.stockBalance.findMany({ where: { AND: [brandWhere(ctx, f.brandId), { productId: { in: products.map((p) => p.id) } }, f.warehouseId ? { warehouseId: f.warehouseId } : {}] } }), db.warehouse.findMany({ select: { id: true, name: true } })]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const totalQty = new Map<string, number>();
  for (const b of balances) totalQty.set(b.productId, (totalQty.get(b.productId) ?? 0) + num(b.qty));
  const cost = canSeeCost(ctx);
  const below = (p: (typeof products)[number]) => p.reorderLevel !== null && (totalQty.get(p.id) ?? 0) <= num(p.reorderLevel);
  const rows: StockRow[] = balances.map((b) => {
    const p = byId.get(b.productId)!;
    return { brandId: b.brandId, productId: b.productId, code: p.code, name: p.name, warehouseId: b.warehouseId, warehouseName: whName.get(b.warehouseId) ?? "—", batchNo: b.batchNo, qty: num(b.qty), reorderLevel: p.reorderLevel !== null ? num(p.reorderLevel) : null, reorderQty: p.reorderQty !== null ? num(p.reorderQty) : null, belowReorder: below(p), ...(cost ? { value: num(b.value) } : {}) };
  });
  // items with a reorder level and no stock at all still need to show up
  for (const p of products) if (!totalQty.has(p.id) && p.reorderLevel !== null && !f.warehouseId) rows.push({ brandId: p.brandId, productId: p.id, code: p.code, name: p.name, warehouseId: "", warehouseName: "—", batchNo: "", qty: 0, reorderLevel: num(p.reorderLevel), reorderQty: p.reorderQty !== null ? num(p.reorderQty) : null, belowReorder: true, ...(cost ? { value: 0 } : {}) });
  return rows.filter((r) => !f.reorderOnly || r.belowReorder).sort((a, b) => a.name.localeCompare(b.name) || a.warehouseName.localeCompare(b.warehouseName));
}

// ───────────────────────────── dashboard ─────────────────────────────

export async function stockDashboard(ctx: AccessContext, brandId?: string | null) {
  assertCan(ctx, "inventory", "read");
  const db = scopedDb(ctx);
  const sales = isSalesView(ctx);
  const now = new Date();
  const units = await db.vehicleUnit.findMany({ where: { AND: [brandWhere(ctx, brandId), sales ? { status: "AVAILABLE" } : { status: { notIn: ["DELIVERED", "TRANSFERRED", "RETURNED", "WRITTEN_OFF"] } }] }, select: { brandId: true, status: true, productId: true, colour: true, warehouseId: true, receivedAt: true, purchaseCost: true, landedCost: true, product: { select: { name: true } }, warehouse: { select: { name: true } } } });
  const count = <K extends string>(key: (u: (typeof units)[number]) => K | null) => {
    const m = new Map<K, number>();
    for (const u of units) {
      const k = key(u);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const byStatus = count((u) => u.status as VehicleStatus);
  const inStock = units.filter((u) => IN_STOCK.includes(u.status as VehicleStatus));
  const ageing = new Map<string, number>();
  for (const u of inStock) {
    const b = ageingBucket(ageingDays(u.receivedAt, now));
    if (b) ageing.set(b, (ageing.get(b) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 12);
  const cost = canSeeCost(ctx);
  const byBrandValue = new Map<string, number>();
  if (cost) for (const u of inStock) byBrandValue.set(u.brandId, round2((byBrandValue.get(u.brandId) ?? 0) + num(u.purchaseCost) + num(u.landedCost)));
  return {
    salesView: sales,
    total: units.length,
    inStock: inStock.length,
    available: byStatus.get("AVAILABLE") ?? 0,
    reserved: (byStatus.get("RESERVED") ?? 0) + (byStatus.get("ALLOCATED") ?? 0),
    pipeline: PIPELINE.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0),
    atPort: (byStatus.get("AT_PORT") ?? 0) + (byStatus.get("IN_CLEARING") ?? 0),
    byStatus: VEHICLE_STATUSES.filter((s) => byStatus.has(s)).map((s) => ({ status: s, label: STATUS_LABELS[s], n: byStatus.get(s)! })),
    byModel: top(count((u) => u.product.name)),
    byColour: top(count((u) => u.colour ?? "—")),
    byWarehouse: top(count((u) => (IN_STOCK.includes(u.status as VehicleStatus) ? (u.warehouse?.name ?? "No warehouse") : null))),
    ageing: AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, n: ageing.get(b.key) ?? 0 })),
    /** stock value per brand – finance only; brands are never added up except for group management */
    value: cost ? [...byBrandValue].map(([b, v]) => ({ brandId: b, value: v })) : null,
    reorder: sales ? [] : (await listStockBalances(ctx, { brandId, reorderOnly: true })).slice(0, 20),
  };
}

// ───────────────────────────── documents ─────────────────────────────

export interface InvDocLine {
  id: string;
  position: number;
  productId: string | null;
  productName: string | null;
  vehicleUnitId: string | null;
  vin: string | null;
  description: string;
  qty: number;
  batchNo: string | null;
  data: Record<string, unknown>;
  unitCost?: number;
  lineTotal?: number;
}
export interface InvDocRow {
  id: string;
  brandId: string;
  type: InvDocType;
  number: string;
  status: string;
  vendorId: string | null;
  vendorName: string | null;
  warehouseId: string | null;
  toWarehouseId: string | null;
  toBrandId: string | null;
  parentId: string | null;
  currency: string;
  exchangeRate: number;
  docDate: string;
  expectedDate: string | null;
  reference: string | null;
  notes: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  total?: number;
  amountPaid?: number;
}
export interface InvDocDetail extends InvDocRow {
  lines: InvDocLine[];
  parentNumber: string | null;
  children: Array<{ id: string; type: InvDocType; number: string; status: string }>;
  journals: Array<{ id: string; number: string; memo: string; lines: Array<{ account: string; debit: number; credit: number }> }>;
}

const json = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Finance-only document types are invisible without finance access; costs are stripped for everyone else. */
function assertDocAccess(ctx: AccessContext, type: InvDocType) {
  assertCan(ctx, "inventory", "read");
  if (isSalesView(ctx)) throw new ForbiddenError("You do not have access to inventory documents");
  if (INV_DOCS[type].area === "inventoryFinance") assertFinance(ctx);
}

type DocRecord = Prisma.InventoryDocumentGetPayload<object>;
function toDocRow(ctx: AccessContext, d: DocRecord, vendorName: string | null): InvDocRow {
  const cost = canSeeCost(ctx);
  const data = json(d.data);
  if (!cost) for (const k of ["allocation", "manual"]) delete data[k];
  return {
    id: d.id,
    brandId: d.brandId,
    type: d.type as InvDocType,
    number: d.number,
    status: d.status,
    vendorId: d.vendorId,
    vendorName,
    warehouseId: d.warehouseId,
    toWarehouseId: d.toWarehouseId,
    toBrandId: d.toBrandId,
    parentId: d.parentId,
    currency: d.currency,
    exchangeRate: num(d.exchangeRate),
    docDate: d.docDate.toISOString().slice(0, 10),
    expectedDate: d.expectedDate?.toISOString().slice(0, 10) ?? null,
    reference: d.reference,
    notes: d.notes,
    data,
    createdAt: d.createdAt.toISOString(),
    ...(cost ? { total: num(d.total), amountPaid: num(d.amountPaid) } : {}),
  };
}

export async function listInvDocuments(ctx: AccessContext, type: InvDocType, f: { brandId?: string | null; status?: string; q?: string } = {}, opts: { take?: number; skip?: number } = {}): Promise<{ rows: InvDocRow[]; total: number }> {
  assertDocAccess(ctx, type);
  const db = scopedDb(ctx);
  const q = f.q?.trim();
  const where: Prisma.InventoryDocumentWhereInput = { AND: [brandWhere(ctx, f.brandId), { type }, f.status ? { status: f.status } : {}, q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { lines: { some: { vin: { contains: normalizeVin(q), mode: "insensitive" } } } }] } : {}] };
  const [rows, total, vendors] = await Promise.all([db.inventoryDocument.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(opts.take ?? 50, 200), skip: opts.skip ?? 0 }), db.inventoryDocument.count({ where }), db.vendor.findMany({ select: { id: true, name: true } })]);
  const vendor = new Map(vendors.map((v) => [v.id, v.name]));
  return { rows: rows.map((d) => toDocRow(ctx, d, d.vendorId ? (vendor.get(d.vendorId) ?? null) : null)), total };
}

export async function getInvDocument(ctx: AccessContext, id: string): Promise<InvDocDetail> {
  assertCan(ctx, "inventory", "read");
  const db = scopedDb(ctx);
  const d = await db.inventoryDocument.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!d) throw new NotFoundError();
  assertDocAccess(ctx, d.type as InvDocType);
  const cost = canSeeCost(ctx);
  const productIds = [...new Set(d.lines.map((l) => l.productId).filter((p): p is string => !!p))];
  const [vendor, products, parent, children, journals] = await Promise.all([
    d.vendorId ? db.vendor.findUnique({ where: { id: d.vendorId }, select: { name: true } }) : null,
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    d.parentId ? db.inventoryDocument.findUnique({ where: { id: d.parentId }, select: { number: true } }) : null,
    db.inventoryDocument.findMany({ where: { parentId: id }, select: { id: true, type: true, number: true, status: true }, orderBy: { createdAt: "asc" } }),
    cost ? db.journalEntry.findMany({ where: { sourceDocId: id }, include: { lines: true }, orderBy: { postedAt: "asc" } }) : [],
  ]);
  const name = new Map(products.map((p) => [p.id, p.name]));
  return {
    ...toDocRow(ctx, d, vendor?.name ?? null),
    parentNumber: parent?.number ?? null,
    children: children.filter((c) => cost || INV_DOCS[c.type as InvDocType].area !== "inventoryFinance").map((c) => ({ ...c, type: c.type as InvDocType })),
    journals: journals.map((j) => ({ id: j.id, number: j.number, memo: j.memo, lines: j.lines.map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit) })) })),
    lines: d.lines.map((l) => ({ id: l.id, position: l.position, productId: l.productId, productName: l.productId ? (name.get(l.productId) ?? null) : null, vehicleUnitId: l.vehicleUnitId, vin: l.vin, description: l.description, qty: num(l.qty), batchNo: l.batchNo, data: json(l.data), ...(cost ? { unitCost: num(l.unitCost), lineTotal: num(l.lineTotal) } : {}) })),
  };
}

/** Inter-brand transfers addressed to the caller's brands: units and transfer price only. */
export async function incomingTransfers(ctx: AccessContext) {
  assertCan(ctx, "inventory", "read");
  if (isSalesView(ctx)) return [];
  const brands = ctx.scope === "ALL" ? (await scopedDb(ctx).brand.findMany({ select: { id: true } })).map((b) => b.id) : ctx.brandIds;
  const rows = await incomingInterBrand(brands);
  return canSeeCost(ctx) ? rows : rows.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l, price: null })) }));
}

// ───────────────────────────── journals ─────────────────────────────

export async function listJournals(ctx: AccessContext, f: { brandId?: string | null } = {}, opts: { take?: number; skip?: number } = {}) {
  assertCan(ctx, "inventory", "read");
  assertFinance(ctx);
  const db = scopedDb(ctx);
  const where = brandWhere(ctx, f.brandId);
  const [rows, total] = await Promise.all([db.journalEntry.findMany({ where, include: { lines: true }, orderBy: [{ date: "desc" }, { number: "desc" }], take: Math.min(opts.take ?? 50, 200), skip: opts.skip ?? 0 }), db.journalEntry.count({ where })]);
  return { rows: rows.map((j) => ({ id: j.id, brandId: j.brandId, number: j.number, date: j.date.toISOString().slice(0, 10), memo: j.memo, sourceDocType: j.sourceDocType, sourceDocId: j.sourceDocId, exportedAt: j.exportedAt?.toISOString() ?? null, total: round2(j.lines.reduce((s, l) => s + num(l.debit), 0)), lines: j.lines.map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit), memo: l.memo })) })), total };
}

export async function getJournal(ctx: AccessContext, id: string) {
  assertCan(ctx, "inventory", "read");
  assertFinance(ctx);
  const j = await scopedDb(ctx).journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!j) throw new NotFoundError();
  return { id: j.id, brandId: j.brandId, number: j.number, date: j.date.toISOString().slice(0, 10), memo: j.memo, sourceDocType: j.sourceDocType, sourceDocId: j.sourceDocId, lines: j.lines.map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit), memo: l.memo })) };
}
