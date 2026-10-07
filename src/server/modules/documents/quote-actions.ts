"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import * as page from "./quote-page";

/** Lookups of one brand for the quote form (owners, deals, rates, grid settings, terms). */
export async function quoteFormDataAction(brandId: string) {
  return safeAction(async () => page.quoteFormData(await requireContext(), brandId));
}

/** Save (→ record page) or Save and New (→ a fresh form keeping brand, owner and currency). */
export async function saveQuotePageAction(id: string | null, input: unknown, mode: "save" | "new" = "save") {
  return safeAction(async () => {
    const res = await page.saveQuotePage(await requireContext(), id, input);
    revalidatePath("/quotes", "layout");
    const d = input as Record<string, unknown>;
    const keep = new URLSearchParams(Object.entries({ brand: d.brandId, owner: d.ownerId, currency: d.currency }).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
    return { id: res.id, number: res.number, message: id ? "Saved" : `${res.number} created`, redirect: mode === "new" ? `/quotes/new?${keep}` : `/quotes/${res.id}` };
  });
}
