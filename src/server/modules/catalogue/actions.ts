"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v.toString()]));

export async function createProductAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const p = await svc.createProduct(ctx, str(fd, "brandId"), { ...obj(fd), active: fd.get("active") === "on" } as never);
    revalidatePath("/products");
    return { message: "Product created successfully", redirect: `/products/${p.id}` };
  });
}

export async function updateProductAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.updateProduct(ctx, id, { ...obj(fd), active: fd.get("active") === "on" } as never);
    revalidatePath(`/products/${id}`);
    return { message: "Product updated successfully", redirect: `/products/${id}` };
  });
}

export async function addStockAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.addStock(await requireContext(), obj(fd));
    revalidatePath(`/products/${str(fd, "productId")}`);
    return { message: "Vehicle added to stock" };
  });
}

const bookInput = (fd: FormData) => ({ name: str(fd, "name"), validFrom: str(fd, "validFrom"), validTo: str(fd, "validTo"), active: fd.get("active") === "on", isDefault: fd.get("isDefault") === "on" });

export async function createPriceBookAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const b = await svc.createPriceBook(await requireContext(), str(fd, "brandId"), bookInput(fd) as never);
    revalidatePath("/priceBooks");
    return { message: "Price book created", redirect: `/priceBooks/${b.id}` };
  });
}

export async function updatePriceBookAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const id = str(fd, "id");
    await svc.updatePriceBook(await requireContext(), id, bookInput(fd) as never);
    revalidatePath(`/priceBooks/${id}`);
    return { message: "Price book saved" };
  });
}

export async function upsertEntryAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const id = str(fd, "priceBookId");
    await svc.upsertEntry(await requireContext(), id, obj(fd));
    revalidatePath(`/priceBooks/${id}`);
    return { message: "Price saved" };
  });
}

export async function removeEntryAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.removeEntry(await requireContext(), str(fd, "entryId"));
    revalidatePath(`/priceBooks/${str(fd, "priceBookId")}`);
    return { message: "Entry removed" };
  });
}

export async function priceImportDryRunAction(priceBookId: string, csvText: string) {
  return safeAction(async () => svc.dryRunPriceImport(await requireContext(), priceBookId, csvText));
}

export async function priceImportCommitAction(priceBookId: string, csvText: string) {
  return safeAction(async () => {
    const res = await svc.commitPriceImport(await requireContext(), priceBookId, csvText);
    revalidatePath(`/priceBooks/${priceBookId}`);
    return res;
  });
}

export async function reserveVinAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const dealId = str(fd, "dealId");
    await svc.reserveVin(await requireContext(), dealId, str(fd, "stockId"));
    revalidatePath(`/deals/${dealId}`);
    return { message: "Vehicle reserved for this deal" };
  });
}

export async function releaseVinAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const dealId = str(fd, "dealId");
    await svc.releaseVin(await requireContext(), dealId);
    revalidatePath(`/deals/${dealId}`);
    return { message: "Reservation released" };
  });
}
