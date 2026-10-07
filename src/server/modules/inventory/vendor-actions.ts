"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as svc from "./service";

const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Create / edit a vendor from the Vendors module (all page fields, optional image). Save and New → a fresh form. */
export async function saveVendorPageAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ message?: string; redirect?: string }>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id") || null;
    const image = fd.get("image");
    const file = image instanceof File && image.size > 0 ? image : null;
    if (file && !IMAGE_TYPES.includes(file.type)) throw new BadRequestError("The vendor image must be a PNG, JPEG or WebP picture");
    if (file && file.size > 512 * 1024) throw new BadRequestError("The vendor image can be at most 512 KB");
    const res = await svc.saveVendor(ctx, id, {
      page: true,
      brandId: str(fd, "brandId"),
      type: str(fd, "type") || "OEM",
      name: str(fd, "name"),
      ownerId: str(fd, "ownerId"),
      contactName: str(fd, "contactName"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      glAccount: str(fd, "glAccount"),
      category: str(fd, "category"),
      emailOptOut: fd.get("emailOptOut") === "on",
      currency: str(fd, "currency") || "NGN",
      paymentTerms: str(fd, "paymentTerms"),
      address: str(fd, "address"),
      city: str(fd, "city"),
      state: str(fd, "state"),
      zipCode: str(fd, "zipCode"),
      country: str(fd, "country"),
      description: str(fd, "description"),
      taxId: str(fd, "taxId"),
      bankDetails: str(fd, "bankDetails"),
      active: id ? fd.get("active") === "on" : true,
    } as never);
    if (file) await scopedDb(ctx).vendor.update({ where: { id: res.id }, data: { imageData: new Uint8Array(await file.arrayBuffer()), imageMimeType: file.type } });
    revalidatePath("/vendors", "layout");
    revalidatePath("/inventory", "layout");
    return { message: "Vendor saved", redirect: !id && fd.get("_saveAndNew") ? "/vendors/new" : `/vendors/${res.id}` };
  });
}
