"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as po from "./purchase-orders";

/** Lookups of one brand for the PO form (owners, vendors, contacts, warehouses, settings, rates). */
export async function poFormDataAction(brandId: string) {
  return safeAction(async () => po.poFormData(await requireContext(), brandId));
}
export async function poProductsAction(brandId: string, vendorId: string | null) {
  return safeAction(async () => po.poProducts(await requireContext(), brandId, vendorId));
}

/** Save (→ record page) or Save and New (→ a fresh form keeping brand, owner, vendor, currency and carrier). */
export async function savePurchaseOrderAction(id: string | null, input: unknown, mode: "save" | "new" = "save") {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await po.savePurchaseOrder(ctx, id, input);
    revalidatePath("/purchaseOrders", "layout");
    revalidatePath("/inventory", "layout");
    const d = input as Record<string, unknown>;
    const keep = new URLSearchParams(Object.entries({ brand: d.brandId, owner: d.ownerId, vendor: d.vendorId, currency: d.currency, carrier: d.carrier }).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
    return { id: res.id, number: res.number, message: id ? "Saved" : `${res.number} created`, redirect: mode === "new" ? `/purchaseOrders/new?${keep}` : `/purchaseOrders/${res.id}` };
  });
}

export async function quickVendorAction(brandId: string, input: { name: string; email?: string; contactName?: string }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await po.quickVendor(ctx, brandId, input);
    return { id: res.id, name: input.name.trim() };
  });
}

/** A new contact person of a vendor (Contact Name lookup). */
export async function quickVendorContactAction(vendorId: string, input: { name: string; email?: string }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const db = scopedDb(ctx);
    const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { brandId: true } });
    if (!vendor) throw new BadRequestError("Unknown vendor");
    const { hasPermission } = await import("@/server/access/can");
    if (!hasPermission(ctx, "inventory", "create")) throw new BadRequestError("You cannot add vendor contacts");
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new BadRequestError("Enter the contact's name");
    const c = await db.vendorContact.create({ data: { brandId: vendor.brandId, vendorId, name, email: input.email?.trim() || null } });
    return { id: c.id, vendorId, name, email: c.email };
  });
}

export async function savePoSettingsAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const brandId = String(fd.get("brandId") ?? "");
    await po.savePoSettings(ctx, brandId, {
      carriers: String(fd.get("carriers") ?? ""),
      poTerms: String(fd.get("poTerms") ?? ""),
      addExciseToTotal: fd.get("addExciseToTotal") === "on",
      allowManualPoNumber: fd.get("allowManualPoNumber") === "on",
      receivingWarehouseId: String(fd.get("receivingWarehouseId") ?? ""),
      poApprovalLimit: String(fd.get("poApprovalLimit") ?? "0"),
    });
    revalidatePath("/setup/purchase-orders");
    return { message: "Purchase order settings saved" };
  });
}

export async function savePoFormViewAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const brandId = String(fd.get("brandId") ?? "");
    const res = await po.savePoFormView(ctx, brandId, { id: String(fd.get("viewId") ?? "") || null, name: String(fd.get("name") ?? ""), hidden: fd.getAll("hidden").map(String) });
    revalidatePath("/setup/purchase-orders");
    return { message: "Form view saved", id: res.id };
  });
}

export async function deletePoFormViewAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    const ctx = await requireContext();
    await po.deletePoFormView(ctx, String(fd.get("brandId") ?? ""), String(fd.get("viewId") ?? ""));
    revalidatePath("/setup/purchase-orders");
    return { message: "Form view deleted" };
  });
}
