"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { reserveVin } from "@/server/modules/catalogue/service";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const refresh = () => revalidatePath("/inventory", "layout");

/** The document editor posts header fields plus the lines as JSON (`lines`) and type-specific data (`data`). */
function docInput(fd: FormData) {
  const parse = (k: string, fallback: unknown) => {
    const raw = str(fd, k);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestError("The document could not be read – reload the page and try again");
    }
  };
  return { brandId: str(fd, "brandId"), vendorId: str(fd, "vendorId"), warehouseId: str(fd, "warehouseId"), toWarehouseId: str(fd, "toWarehouseId"), toBrandId: str(fd, "toBrandId"), parentId: str(fd, "parentId"), currency: str(fd, "currency"), exchangeRate: str(fd, "exchangeRate"), docDate: str(fd, "docDate"), expectedDate: str(fd, "expectedDate"), reference: str(fd, "reference"), notes: str(fd, "notes"), data: parse("data", {}), lines: parse("lines", []) };
}

export async function saveInvDocumentAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    if (id) {
      await svc.updateInvDocument(ctx, id, docInput(fd));
      refresh();
      return { message: "Saved", redirect: `/inventory/documents/${id}` };
    }
    const doc = await svc.createInvDocument(ctx, str(fd, "type"), docInput(fd));
    refresh();
    return { message: `${doc.number} created`, redirect: `/inventory/documents/${doc.id}` };
  });
}

export async function transitionAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await svc.transition(await requireContext(), str(fd, "id"), str(fd, "action"), { amount: str(fd, "amount"), note: str(fd, "note") });
    refresh();
    revalidatePath("/purchaseOrders", "layout");
    return { message: ("message" in res && typeof res.message === "string" && res.message) || `Done – ${res.status.toLowerCase().replace(/_/g, " ")}` };
  });
}

export async function approveIncomingAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await svc.approveInterBrand(await requireContext(), str(fd, "id"), "to");
    refresh();
    return { message: res.status === "APPROVED" ? "Approved – the transfer can be shipped" : `Approved. Still needed: ${res.missing.join(", ")}` };
  });
}

export async function receiveIncomingAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const lineProducts: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("product:") && v) lineProducts[k.slice(8)] = String(v);
    await svc.receiveInterBrand(await requireContext(), str(fd, "id"), { toWarehouseId: str(fd, "toWarehouseId"), lineProducts });
    refresh();
    return { message: "Received into stock – the units now wait for PDI" };
  });
}

export async function recordCountAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const counts: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("count:")) counts[k.slice(6)] = String(v);
    const res = await svc.recordCount(await requireContext(), str(fd, "id"), { vins: str(fd, "vins").split(/[\s,;]+/).filter(Boolean), counts });
    refresh();
    return { message: `${res.matched} vehicle(s) matched${res.unexpected.length ? ` · ${res.unexpected.length} not expected in this warehouse` : ""}` };
  });
}

export async function startPdiAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const doc = await svc.startPdi(await requireContext(), str(fd, "unitId"));
    refresh();
    return { redirect: `/inventory/documents/${doc.id}` };
  });
}

export async function completePdiAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const results: Record<string, boolean> = {};
    for (const item of fd.getAll("item").map(String)) results[item] = fd.get(`ok:${item}`) === "on";
    const res = await svc.completePdi(await requireContext(), str(fd, "id"), { results, notes: str(fd, "notes") || null });
    refresh();
    return { message: res.passed ? "PDI passed – the unit is available for sale" : "PDI failed – the unit is on hold" };
  });
}

export async function unitAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "unitId");
    const op = str(fd, "op");
    if (op === "demo-on") await svc.setDemo(ctx, id, true, str(fd, "mileage") ? Number(str(fd, "mileage")) : null);
    else if (op === "demo-off") await svc.setDemo(ctx, id, false, str(fd, "mileage") ? Number(str(fd, "mileage")) : null);
    else if (op === "extend") await svc.extendReservation(ctx, id, Number(str(fd, "days") || 7));
    else if (op === "reserve") await reserveVin(ctx, str(fd, "dealId"), id);
    else if (op === "update") await svc.updateUnit(ctx, id, Object.fromEntries([...fd.entries()].filter(([k]) => !["unitId", "op"].includes(k)).map(([k, v]) => [k, String(v)])));
    else throw new BadRequestError("Unknown action");
    refresh();
    return { message: op === "reserve" ? "Reserved for the deal" : "Saved" };
  });
}

export async function saveWarehouseAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.saveWarehouse(await requireContext(), str(fd, "id") || null, { brandId: str(fd, "brandId"), code: str(fd, "code"), name: str(fd, "name"), type: str(fd, "type"), regionId: str(fd, "regionId"), address: str(fd, "address"), active: str(fd, "id") ? fd.get("active") === "on" : true });
    refresh();
    return { message: "Warehouse saved" };
  });
}

export async function saveVendorAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.saveVendor(await requireContext(), str(fd, "id") || null, { brandId: str(fd, "brandId"), type: str(fd, "type"), name: str(fd, "name"), contactName: str(fd, "contactName"), email: str(fd, "email"), phone: str(fd, "phone"), currency: str(fd, "currency"), paymentTerms: str(fd, "paymentTerms"), address: str(fd, "address"), taxId: str(fd, "taxId"), bankDetails: str(fd, "bankDetails"), active: str(fd, "id") ? fd.get("active") === "on" : true });
    refresh();
    return { message: "Vendor saved" };
  });
}

export async function saveSettingsAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const accounts: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("account:")) accounts[k.slice(8)] = String(v);
    await svc.saveSettings(await requireContext(), str(fd, "brandId"), { reservationDays: str(fd, "reservationDays"), adjustmentApprovalLimit: str(fd, "adjustmentApprovalLimit"), poApprovalLimit: str(fd, "poApprovalLimit"), lockDate: str(fd, "lockDate"), partsValuation: str(fd, "partsValuation"), pdiTemplate: str(fd, "pdiTemplate"), accounts });
    refresh();
    return { message: "Inventory settings saved" };
  });
}

export async function saveItemStockAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.saveItemStockFields(await requireContext(), str(fd, "productId"), { reorderLevel: str(fd, "reorderLevel"), reorderQty: str(fd, "reorderQty"), hsCode: str(fd, "hsCode"), uom: str(fd, "uom"), trackingType: str(fd, "trackingType") });
    refresh();
    return { message: "Reorder settings saved" };
  });
}
