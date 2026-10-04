/**
 * Inventory reports (prompt 16 §7). Every report reads through `scopedDb`, so it only ever contains the
 * caller's brands; value, cost and margin reports (and columns) need inventory finance access; the group
 * consolidation is for group-wide users only.
 */
import "server-only";
import { brandTagWhere } from "@/server/access/brand-tag";
import { assertCan } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { round2 } from "./costing";
import { assertFinance, canSeeCost, isSalesView, listStockBalances } from "./queries";
import { IN_STOCK, PIPELINE, STATUS_LABELS, ageingBucket, ageingDays, type VehicleStatus } from "./status";
import { normalizeVin } from "./vin";

type Cell = string | number | null;
export interface InvReport {
  key: string;
  title: string;
  columns: string[];
  rows: Cell[][];
  note?: string;
}

export const INV_REPORTS: Array<{ key: string; title: string; finance?: boolean; group?: boolean; param?: "vin" | "asOf" }> = [
  { key: "stock-on-hand", title: "Stock on hand by brand, warehouse and model" },
  { key: "ageing", title: "Vehicle ageing" },
  { key: "availability", title: "Available vs reserved vs allocated" },
  { key: "pipeline", title: "In transit and port pipeline" },
  { key: "days-of-cover", title: "Sales vs stock (days of cover per model)" },
  { key: "slow-moving", title: "Slow-moving and dead stock (over 90 days)" },
  { key: "reorder", title: "Reorder report (parts)" },
  { key: "count-variance", title: "Stock count variance" },
  { key: "movements", title: "Stock movement history per VIN", param: "vin" },
  { key: "landed-cost", title: "Landed cost breakdown per VIN", finance: true },
  { key: "valuation", title: "Inventory valuation as of a date", finance: true, param: "asOf" },
  { key: "margin", title: "Gross margin per VIN", finance: true },
  { key: "consolidated", title: "Group consolidated stock", group: true },
];

const num = (d: { toString(): string } | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));

export async function runInvReport(ctx: AccessContext, key: string, params: { brandId?: string | null; vin?: string; asOf?: string } = {}): Promise<InvReport> {
  assertCan(ctx, "inventory", "read");
  if (isSalesView(ctx)) throw new ForbiddenError("You do not have access to inventory reports");
  const def = INV_REPORTS.find((r) => r.key === key);
  if (!def) throw new NotFoundError();
  if (def.finance) assertFinance(ctx);
  if (def.group && ctx.scope !== "ALL") throw new ForbiddenError("The group consolidation is for group management");
  const db = scopedDb(ctx);
  const cost = canSeeCost(ctx);
  const now = new Date();
  const where = { AND: [brandTagWhere(ctx), params.brandId ? { brandId: params.brandId } : {}] };
  const [brands, warehouses] = await Promise.all([db.brand.findMany({ select: { id: true, code: true } }), db.warehouse.findMany({ where, select: { id: true, name: true } })]);
  const code = (id: string) => brands.find((b) => b.id === id)?.code ?? "?";
  const wh = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "—";
  const units = () => db.vehicleUnit.findMany({ where, include: { product: { select: { name: true, listPrice: true } } }, orderBy: [{ brandId: "asc" }, { vin: "asc" }], take: 20_000 });
  const total = (u: { purchaseCost: unknown; landedCost: unknown }) => round2(num(u.purchaseCost as never) + num(u.landedCost as never));
  const out = (columns: string[], rows: Cell[][], note?: string): InvReport => ({ key, title: def.title, columns, rows, note });

  switch (key) {
    case "stock-on-hand": {
      const m = new Map<string, { brand: string; warehouse: string; model: string; n: number; value: number }>();
      for (const u of (await units()).filter((x) => IN_STOCK.includes(x.status as VehicleStatus))) {
        const k = `${u.brandId}|${u.warehouseId}|${u.productId}`;
        const r = m.get(k) ?? { brand: code(u.brandId), warehouse: wh(u.warehouseId), model: u.product.name, n: 0, value: 0 };
        m.set(k, { ...r, n: r.n + 1, value: round2(r.value + total(u)) });
      }
      return out(["Brand", "Warehouse", "Model", "Units", ...(cost ? ["Value at cost"] : [])], [...m.values()].map((r) => [r.brand, r.warehouse, r.model, r.n, ...(cost ? [r.value] : [])]));
    }
    case "ageing":
    case "slow-moving": {
      const rows = (await units())
        .filter((u) => IN_STOCK.includes(u.status as VehicleStatus))
        .map((u) => ({ u, days: ageingDays(u.receivedAt, now) }))
        .filter((r) => key === "ageing" || (r.days ?? 0) > 90)
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
      return out(["Brand", "VIN", "Model", "Colour", "Warehouse", "Status", "Days in stock", "Bucket", ...(cost ? ["Cost"] : [])], rows.map(({ u, days }) => [code(u.brandId), u.vin, u.product.name, u.colour, wh(u.warehouseId), STATUS_LABELS[u.status as VehicleStatus], days, ageingBucket(days), ...(cost ? [total(u)] : [])]));
    }
    case "availability": {
      const m = new Map<string, { brand: string; model: string; available: number; reserved: number; allocated: number; pipeline: number }>();
      for (const u of await units()) {
        const k = `${u.brandId}|${u.productId}`;
        const r = m.get(k) ?? { brand: code(u.brandId), model: u.product.name, available: 0, reserved: 0, allocated: 0, pipeline: 0 };
        if (u.status === "AVAILABLE") r.available++;
        else if (u.status === "RESERVED") r.reserved++;
        else if (u.status === "ALLOCATED" || u.status === "INVOICED") r.allocated++;
        else if (PIPELINE.includes(u.status as VehicleStatus)) r.pipeline++;
        m.set(k, r);
      }
      return out(["Brand", "Model", "Available", "Reserved", "Allocated / invoiced", "On the way"], [...m.values()].map((r) => [r.brand, r.model, r.available, r.reserved, r.allocated, r.pipeline]));
    }
    case "pipeline": {
      const rows = (await units()).filter((u) => PIPELINE.includes(u.status as VehicleStatus));
      const shipments = await db.inventoryDocument.findMany({ where: { id: { in: [...new Set(rows.map((u) => u.shipmentId).filter((s): s is string => !!s))] } }, select: { id: true, number: true, reference: true, expectedDate: true, status: true } });
      const sh = (id: string | null) => shipments.find((s) => s.id === id);
      return out(["Brand", "VIN", "Model", "Status", "Shipment", "B/L no.", "ETA"], rows.map((u) => [code(u.brandId), u.vin, u.product.name, STATUS_LABELS[u.status as VehicleStatus], sh(u.shipmentId)?.number ?? null, sh(u.shipmentId)?.reference ?? null, sh(u.shipmentId)?.expectedDate?.toISOString().slice(0, 10) ?? null]));
    }
    case "days-of-cover": {
      const since = new Date(now.getTime() - 90 * 86_400_000);
      const m = new Map<string, { brand: string; model: string; stock: number; sold: number }>();
      for (const u of await units()) {
        const k = `${u.brandId}|${u.productId}`;
        const r = m.get(k) ?? { brand: code(u.brandId), model: u.product.name, stock: 0, sold: 0 };
        if (["AVAILABLE", "PDI_PENDING", "RESERVED"].includes(u.status)) r.stock++;
        if (u.soldAt && u.soldAt >= since) r.sold++;
        m.set(k, r);
      }
      return out(["Brand", "Model", "Sellable stock", "Sold in 90 days", "Days of cover"], [...m.values()].map((r) => [r.brand, r.model, r.stock, r.sold, r.sold ? Math.round((r.stock / r.sold) * 90) : null]), "Days of cover = sellable stock ÷ average daily sales of the last 90 days; empty when nothing was sold.");
    }
    case "reorder":
      return out(["Brand", "Code", "Item", "On hand", "Reorder level", "Suggested order"], (await listStockBalances(ctx, { brandId: params.brandId, reorderOnly: true })).map((r) => [code(r.brandId), r.code, r.name, r.qty, r.reorderLevel, r.reorderQty]));
    case "count-variance": {
      const counts = await db.inventoryDocument.findMany({ where: { AND: [where, { type: "STOCK_COUNT", status: "RECONCILED" }] }, orderBy: { docDate: "desc" }, take: 200 });
      return out(["Brand", "Count", "Date", "Warehouse", "Name", "Variances"], counts.map((c) => [code(c.brandId), c.number, c.docDate.toISOString().slice(0, 10), wh(c.warehouseId), c.reference, Number((c.data as { variances?: number } | null)?.variances ?? 0)]));
    }
    case "movements": {
      const vin = normalizeVin(params.vin ?? "");
      if (!vin) return out(["Date", "Movement", "Warehouse", "In", "Out"], [], "Enter a VIN.");
      const unit = await db.vehicleUnit.findFirst({ where: { AND: [where, { vin }] }, select: { id: true } });
      if (!unit) return out(["Date", "Movement", "Warehouse", "In", "Out"], [], "No vehicle with this VIN."); // another brand's VIN is simply not found
      const rows = await db.stockMovement.findMany({ where: { vehicleUnitId: unit.id }, orderBy: [{ at: "asc" }, { id: "asc" }] });
      return out(["Date", "Movement", "Warehouse", "In", "Out", ...(cost ? ["Value"] : [])], rows.map((r) => [r.at.toISOString().slice(0, 10), r.movementType, wh(r.warehouseId), num(r.qtyIn), num(r.qtyOut), ...(cost ? [num(r.totalCost)] : [])]));
    }
    case "landed-cost":
      return out(["Brand", "VIN", "Model", "Purchase cost", "Landed cost", "Total cost", "Landed %"], (await units()).filter((u) => num(u.landedCost) > 0).map((u) => [code(u.brandId), u.vin, u.product.name, num(u.purchaseCost), num(u.landedCost), total(u), num(u.purchaseCost) ? round2((num(u.landedCost) / num(u.purchaseCost)) * 100) : null]));
    case "valuation": {
      const asOf = params.asOf && !Number.isNaN(Date.parse(params.asOf)) ? new Date(`${params.asOf.slice(0, 10)}T23:59:59.999Z`) : now;
      // the ledger is append-only, so the value at any date is the sum of the movements up to it
      const sums = await db.stockMovement.groupBy({ by: ["brandId", "productId", "warehouseId", "movementType"], where: { AND: [where, { at: { lte: asOf } }] }, _sum: { qtyIn: true, qtyOut: true, totalCost: true } });
      const products = await db.product.findMany({ where, select: { id: true, name: true } });
      const m = new Map<string, { brand: string; warehouse: string; item: string; qty: number; value: number }>();
      for (const s of sums) {
        const k = `${s.brandId}|${s.warehouseId}|${s.productId}`;
        const r = m.get(k) ?? { brand: code(s.brandId), warehouse: wh(s.warehouseId), item: products.find((p) => p.id === s.productId)?.name ?? "?", qty: 0, value: 0 };
        const qtyIn = num(s._sum.qtyIn);
        const qtyOut = num(s._sum.qtyOut);
        const sign = s.movementType === "LANDED_COST" || qtyIn > 0 ? 1 : -1;
        m.set(k, { ...r, qty: round2(r.qty + qtyIn - qtyOut), value: round2(r.value + sign * num(s._sum.totalCost)) });
      }
      await audit({ ctx, action: "EXPORT", entity: "InventoryValuation", after: { asOf: asOf.toISOString().slice(0, 10), brandId: params.brandId ?? null } });
      return out(["Brand", "Warehouse", "Item", "Quantity", "Value at cost"], [...m.values()].filter((r) => r.qty !== 0 || r.value !== 0).map((r) => [r.brand, r.warehouse, r.item, r.qty, r.value]), `As of ${asOf.toISOString().slice(0, 10)}. Each brand is its own legal entity: totals are per brand.`);
    }
    case "margin": {
      const sold = (await units()).filter((u) => ["INVOICED", "DELIVERED"].includes(u.status) && u.invoiceId);
      const lines = await db.documentLine.findMany({ where: { invoiceId: { in: sold.map((u) => u.invoiceId!) }, vin: { in: sold.map((u) => u.vin) } }, select: { invoiceId: true, vin: true, lineTotal: true } });
      return out(["Brand", "VIN", "Model", "Sold", "Net sale", "Cost", "Gross margin", "Margin %"], sold.map((u) => {
        const sale = num(lines.find((l) => l.invoiceId === u.invoiceId && l.vin === u.vin)?.lineTotal);
        const c = total(u);
        return [code(u.brandId), u.vin, u.product.name, u.soldAt?.toISOString().slice(0, 10) ?? null, sale || null, c, sale ? round2(sale - c) : null, sale ? round2(((sale - c) / sale) * 100) : null];
      }), "Net sale = the invoice line of the VIN before VAT.");
    }
    case "consolidated": {
      const m = new Map<string, { inStock: number; available: number; reserved: number; pipeline: number; value: number }>();
      for (const u of await units()) {
        const r = m.get(u.brandId) ?? { inStock: 0, available: 0, reserved: 0, pipeline: 0, value: 0 };
        const st = u.status as VehicleStatus;
        if (IN_STOCK.includes(st)) {
          r.inStock++;
          r.value = round2(r.value + total(u));
        }
        if (st === "AVAILABLE") r.available++;
        if (st === "RESERVED" || st === "ALLOCATED") r.reserved++;
        if (PIPELINE.includes(st)) r.pipeline++;
        m.set(u.brandId, r);
      }
      return out(["Brand", "In stock", "Available", "Reserved / allocated", "On the way", ...(cost ? ["Value at cost"] : [])], [...m].map(([b, r]) => [code(b), r.inStock, r.available, r.reserved, r.pipeline, ...(cost ? [r.value] : [])]));
    }
    default:
      throw new NotFoundError();
  }
}
