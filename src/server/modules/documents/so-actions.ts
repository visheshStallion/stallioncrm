"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import * as page from "./so-page";

/** Lookups of one brand for the sales order form (owners, quotes, deals, carriers, rates, grid settings). */
export async function orderFormDataAction(brandId: string) {
  return safeAction(async () => page.orderFormData(await requireContext(), brandId));
}
/** "Copy details and items from QT-…": header, address and lines of the quote. */
export async function quoteForOrderAction(quoteId: string) {
  return safeAction(async () => page.quoteForOrder(await requireContext(), quoteId));
}
/** Save (→ record page) or Save and New (→ a fresh form keeping brand, owner, currency and carrier). */
export async function saveOrderPageAction(id: string | null, input: unknown, mode: "save" | "new" = "save") {
  return safeAction(async () => {
    const res = await page.saveOrderPage(await requireContext(), id, input);
    revalidatePath("/salesOrders", "layout");
    const d = input as Record<string, unknown>;
    const keep = new URLSearchParams(Object.entries({ brand: d.brandId, owner: d.ownerId, currency: d.currency, carrier: d.carrier }).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
    return { id: res.id, number: res.number, message: id ? "Saved" : `${res.number} created`, redirect: mode === "new" ? `/salesOrders/new?${keep}` : `/salesOrders/${res.id}` };
  });
}
