/** Route handlers of /api/v1/inventory/* (prompt 16 §8) – scoped exactly like the UI. */
import "server-only";
import { apiHandler } from "@/server/api";
import { NotFoundError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { requireApiContext } from "@/server/request";
import type { InvDocType } from "./config";
import { getInvDocument, getJournal, getUnit, isSalesView, listInvDocuments, listJournals, listStockBalances, listUnits, listVendors, listWarehouses } from "./queries";
import { createInvDocument, saveVendor, saveWarehouse, updateInvDocument, updateUnit } from "./service";

const DOC_RESOURCES: Record<string, InvDocType> = {
  "purchase-orders": "PO",
  shipments: "SHIPMENT",
  receives: "GRN",
  bills: "BILL",
  "landed-costs": "LANDED_COST",
  transfers: "TRANSFER",
  "inter-brand-transfers": "INTER_BRAND",
  adjustments: "ADJUSTMENT",
  "stock-counts": "STOCK_COUNT",
  "vendor-credits": "VENDOR_CREDIT",
  "delivery-notes": "DELIVERY_NOTE",
  "pdi-checklists": "PDI",
};

type ListParams = { params: Promise<{ resource: string }> };
type ItemParams = { params: Promise<{ resource: string; id: string }> };

export const listRoute = apiHandler<ListParams>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { resource } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parseApiPaging(sp);
  const page = { take: paging.per, skip: paging.skip };
  if (resource === "vehicle-units") {
    const { rows, total } = await listUnits(ctx, sp, page);
    return Response.json({ data: rows, meta: listMeta(total, paging) });
  }
  if (resource === "warehouses") return Response.json({ data: await listWarehouses(ctx, sp.brandId) });
  if (resource === "vendors") return Response.json({ data: await listVendors(ctx, sp.brandId) });
  if (resource === "stock") return Response.json({ data: await listStockBalances(ctx, { brandId: sp.brandId, warehouseId: sp.warehouseId, reorderOnly: sp.reorder === "1" }) });
  if (resource === "items") {
    // items are the products of the caller's brands with their inventory fields; cost price is finance-only
    if (isSalesView(ctx)) throw new NotFoundError();
    const cost = ctx.profile.permissions.inventoryFinance?.read === true;
    const where = { ...(sp.brandId ? { brandId: sp.brandId } : {}) };
    const db = scopedDb(ctx);
    const [rows, total] = await Promise.all([db.product.findMany({ where, select: { id: true, brandId: true, code: true, name: true, category: true, trackingType: true, valuationMethod: true, uom: true, reorderLevel: true, reorderQty: true, hsCode: true, costPrice: true, active: true }, orderBy: { code: "asc" }, take: paging.per, skip: paging.skip }), db.product.count({ where })]);
    return Response.json({ data: rows.map(({ costPrice, ...r }) => ({ ...r, reorderLevel: r.reorderLevel === null ? null : Number(r.reorderLevel), reorderQty: r.reorderQty === null ? null : Number(r.reorderQty), ...(cost ? { costPrice: costPrice === null ? null : Number(costPrice) } : {}) })), meta: listMeta(total, paging) });
  }
  if (resource === "journals") {
    const { rows, total } = await listJournals(ctx, { brandId: sp.brandId }, page);
    return Response.json({ data: rows, meta: listMeta(total, paging) });
  }
  const type = DOC_RESOURCES[resource];
  if (!type) throw new NotFoundError();
  const { rows, total } = await listInvDocuments(ctx, type, { brandId: sp.brandId, status: sp.status, q: sp.q }, page);
  return Response.json({ data: rows, meta: listMeta(total, paging) });
});

export const createRoute = apiHandler<ListParams>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { resource } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  if (resource === "warehouses") return Response.json({ data: await saveWarehouse(ctx, null, body) }, { status: 201 });
  if (resource === "vendors") return Response.json({ data: await saveVendor(ctx, null, body) }, { status: 201 });
  const type = DOC_RESOURCES[resource];
  if (!type) throw new NotFoundError();
  const doc = await createInvDocument(ctx, type, body);
  return Response.json({ data: await getInvDocument(ctx, doc.id) }, { status: 201 });
});

async function item(ctx: Awaited<ReturnType<typeof requireApiContext>>, resource: string, id: string) {
  if (resource === "vehicle-units") return getUnit(ctx, id);
  if (resource === "journals") return getJournal(ctx, id);
  const type = DOC_RESOURCES[resource];
  if (!type) throw new NotFoundError();
  const doc = await getInvDocument(ctx, id);
  if (doc.type !== type) throw new NotFoundError();
  return doc;
}

export const itemRoute = apiHandler<ItemParams>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { resource, id } = await params;
  return Response.json({ data: await item(ctx, resource, id) });
});

export const updateRoute = apiHandler<ItemParams>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { resource, id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  if (resource === "vehicle-units") await updateUnit(ctx, id, body);
  else if (resource === "warehouses") await saveWarehouse(ctx, id, body);
  else if (resource === "vendors") await saveVendor(ctx, id, body);
  else {
    await item(ctx, resource, id); // 404 when it is not this kind of document
    await updateInvDocument(ctx, id, body);
  }
  return Response.json({ data: resource === "warehouses" || resource === "vendors" ? { id } : await item(ctx, resource, id) });
});
