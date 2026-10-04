import "server-only";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { ADJUSTMENT_ACTIONS, ADJUSTMENT_REASONS, CHARGE_TYPES, CURRENCIES, type InvDocConfig } from "@/server/modules/inventory/config";
import { canSeeCost, getInvDocument, type InvDocDetail } from "@/server/modules/inventory/queries";
import { STATUS_LABELS, type VehicleStatus } from "@/server/modules/inventory/status";
import type { EditorLine, EditorLookups, EditorValues } from "./DocEditor";

const UNIT_STATUSES: Partial<Record<InvDocConfig["type"], VehicleStatus[]>> = {
  TRANSFER: ["PDI_PENDING", "AVAILABLE", "DEMO", "ON_HOLD"],
  INTER_BRAND: ["PDI_PENDING", "AVAILABLE"],
  ADJUSTMENT: ["PDI_PENDING", "AVAILABLE", "DEMO", "ON_HOLD"],
  VENDOR_CREDIT: ["PDI_PENDING", "AVAILABLE", "ON_HOLD"],
  LANDED_COST: ["PDI_PENDING", "AVAILABLE", "DEMO", "ON_HOLD", "RESERVED", "ALLOCATED"],
};

/** Everything the editor's selects need – of ONE brand (scopedDb would not return another brand's rows anyway). */
export async function editorLookups(ctx: AccessContext, cfg: InvDocConfig, brandId: string): Promise<EditorLookups> {
  const db = scopedDb(ctx);
  const statuses = UNIT_STATUSES[cfg.type];
  const [products, units, warehouses, vendors, brands, parents] = await Promise.all([
    db.product.findMany({ where: { brandId, active: true }, select: { id: true, name: true, trackingType: true }, orderBy: { name: "asc" } }),
    statuses ? db.vehicleUnit.findMany({ where: { brandId, status: { in: statuses }, warehouseId: { not: null } }, select: { id: true, vin: true, status: true, warehouseId: true, product: { select: { name: true } } }, orderBy: { vin: "asc" }, take: 500 }) : [],
    db.warehouse.findMany({ where: { brandId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.vendor.findMany({ where: { brandId, active: true }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }),
    db.brand.findMany({ where: { id: { not: brandId }, status: { not: "INACTIVE" } }, select: { id: true, code: true }, orderBy: { code: "asc" } }),
    cfg.parentTypes?.length ? db.inventoryDocument.findMany({ where: { brandId, type: { in: cfg.parentTypes }, status: { notIn: ["DRAFT", "CANCELLED", "CLOSED"] } }, select: { id: true, number: true, type: true, reference: true }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
  ]);
  return {
    products: products.map((p) => ({ id: p.id, name: p.name, serial: p.trackingType === "SERIAL" })),
    units: units.map((u) => ({ id: u.id, label: `${u.vin} · ${u.product.name} · ${STATUS_LABELS[u.status as VehicleStatus]}`, warehouseId: u.warehouseId })),
    warehouses,
    vendors,
    otherBrands: brands,
    parents: parents.map((p) => ({ id: p.id, label: `${p.number}${p.reference ? ` · ${p.reference}` : ""}` })),
    chargeTypes: [...CHARGE_TYPES],
    currencies: [...CURRENCIES],
    adjustmentActions: [...ADJUSTMENT_ACTIONS],
    reasons: [...ADJUSTMENT_REASONS],
  };
}

const line = (over: Partial<EditorLine>): EditorLine => ({ productId: "", vehicleUnitId: "", vin: "", description: "", qty: "1", unitCost: "", batchNo: "", colour: "", action: "WRITE_OFF", chargeType: "", ...over });
const today = () => new Date().toISOString().slice(0, 10);

export function valuesOf(doc: InvDocDetail): EditorValues {
  return {
    id: doc.id,
    vendorId: doc.vendorId ?? "",
    warehouseId: doc.warehouseId ?? "",
    toWarehouseId: doc.toWarehouseId ?? "",
    toBrandId: doc.toBrandId ?? "",
    parentId: doc.parentId ?? "",
    currency: doc.currency,
    exchangeRate: String(doc.exchangeRate),
    docDate: doc.docDate,
    expectedDate: doc.expectedDate ?? "",
    reference: doc.reference ?? "",
    notes: doc.notes ?? "",
    data: doc.data,
    lines: doc.lines.map((l) => line({ productId: l.vehicleUnitId && doc.type !== "GRN" && doc.type !== "SHIPMENT" ? "" : (l.productId ?? ""), vehicleUnitId: doc.type === "GRN" || doc.type === "SHIPMENT" ? "" : (l.vehicleUnitId ?? ""), vin: l.vin ?? "", description: l.description, qty: String(l.qty), unitCost: l.unitCost !== undefined ? String(l.unitCost) : "", batchNo: l.batchNo ?? "", colour: String(l.data.colour ?? ""), action: String(l.data.action ?? "WRITE_OFF"), chargeType: String(l.data.chargeType ?? "") })),
  };
}

/** A new document, pre-filled from the document it follows (PO → shipment / receipt → bill; shipment → landed cost). */
export async function newValues(ctx: AccessContext, cfg: InvDocConfig, brandId: string, parentId?: string): Promise<EditorValues> {
  const empty: EditorValues = { vendorId: "", warehouseId: "", toWarehouseId: "", toBrandId: "", parentId: "", currency: "NGN", exchangeRate: "1", docDate: today(), expectedDate: "", reference: "", notes: "", data: {}, lines: [] };
  if (!parentId) return empty;
  const parent = await getInvDocument(ctx, parentId).catch(() => null);
  if (!parent || parent.brandId !== brandId || !(cfg.parentTypes ?? []).includes(parent.type)) return empty;
  const base = { ...empty, parentId, vendorId: parent.vendorId ?? "", currency: parent.currency, exchangeRate: String(parent.exchangeRate), warehouseId: parent.warehouseId ?? "" };
  const db = scopedDb(ctx);
  const serial = new Set((await db.product.findMany({ where: { brandId, trackingType: "SERIAL" }, select: { id: true } })).map((p) => p.id));
  // the purchase order's prices (a shipment carries none): finance users only
  const priced = parent.type === "SHIPMENT" && parent.parentId && canSeeCost(ctx) ? await getInvDocument(ctx, parent.parentId).catch(() => null) : parent;
  const priceOf = (productId: string | null) => {
    const hit = priced?.lines.find((l) => l.productId === productId);
    return hit?.unitCost !== undefined ? String(hit.unitCost) : "";
  };
  if (cfg.type === "SHIPMENT" || cfg.type === "GRN") {
    // one line per vehicle (the VIN is captured per unit), one line per part with its quantity
    const lines = parent.lines.flatMap((l) => (l.productId && serial.has(l.productId) ? Array.from({ length: Math.max(1, Math.round(l.qty)) }, () => line({ productId: l.productId!, vin: l.vin ?? "", colour: String(l.data.colour ?? ""), unitCost: priceOf(l.productId) })) : [line({ productId: l.productId ?? "", qty: String(l.qty), unitCost: priceOf(l.productId), batchNo: l.batchNo ?? "" })]));
    if (priced && priced !== parent) Object.assign(base, { currency: priced.currency, exchangeRate: String(priced.exchangeRate), vendorId: priced.vendorId ?? base.vendorId, warehouseId: priced.warehouseId ?? base.warehouseId });
    return { ...base, lines };
  }
  if (cfg.type === "BILL") return { ...base, lines: [line({ description: `Goods per ${parent.number}`, chargeType: "", unitCost: parent.total !== undefined ? String(parent.total) : "" })] };
  if (cfg.type === "LANDED_COST") {
    const shipmentId = parent.type === "SHIPMENT" ? parent.id : parent.parentId;
    const units = shipmentId ? await db.vehicleUnit.findMany({ where: { brandId, shipmentId, warehouseId: { not: null } }, select: { id: true } }) : [];
    const received = parent.type === "GRN" ? parent.lines.map((l) => l.vehicleUnitId).filter((x): x is string => !!x) : [];
    return { ...base, vendorId: "", currency: "NGN", exchangeRate: "1", data: { method: "VALUE", unitIds: [...new Set([...units.map((u) => u.id), ...received])] }, lines: [line({ chargeType: "Customs duty", description: "Customs duty", unitCost: "" })] };
  }
  return base;
}
