"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import * as page from "./invoice-page";

/** Lookups of one brand for the invoice form (owners, open sales orders, settings, rates, grid settings). */
export async function invoiceFormDataAction(brandId: string) {
  return safeAction(async () => page.invoiceFormData(await requireContext(), brandId));
}
export async function searchAccountsAction(q: string) {
  return safeAction(async () => page.searchAccounts(await requireContext(), q));
}
export async function accountLinksAction(brandId: string, accountId: string | null) {
  return safeAction(async () => page.accountLinks(await requireContext(), brandId, accountId));
}
/** "Copy details and items from SO-…": header, addresses and the lines still to invoice. */
export async function orderForInvoiceAction(orderId: string) {
  return safeAction(async () => page.orderForInvoice(await requireContext(), orderId));
}

/** Save (→ record page) or Save and New (→ a fresh form keeping brand, owner and currency). */
export async function saveInvoicePageAction(id: string | null, input: unknown, mode: "save" | "new" = "save") {
  return safeAction(async () => {
    const res = await page.saveInvoicePage(await requireContext(), id, input);
    revalidatePath("/invoices", "layout");
    const d = input as Record<string, unknown>;
    const keep = new URLSearchParams(Object.entries({ brand: d.brandId, owner: d.ownerId, currency: d.currency }).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
    return { id: res.id, number: res.number, message: id ? "Saved" : `${res.number} created`, redirect: mode === "new" ? `/invoices/new?${keep}` : `/invoices/${res.id}` };
  });
}

export async function saveInvoiceSettingsAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    await page.saveInvoiceSettings(await requireContext(), String(fd.get("brandId") ?? ""), {
      paymentTermsDays: String(fd.get("paymentTermsDays") ?? "7"),
      tinRequiredB2B: fd.get("tinRequiredB2B") === "on",
      exciseInTotal: fd.get("exciseInTotal") === "on",
      otherChargesEnabled: fd.get("otherChargesEnabled") === "on",
    });
    revalidatePath("/setup/invoice-settings");
    return { message: "Invoice settings saved" };
  });
}

export async function saveInvoiceFormViewAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    const res = await page.saveInvoiceFormView(await requireContext(), String(fd.get("brandId") ?? ""), { id: String(fd.get("viewId") ?? "") || null, name: String(fd.get("name") ?? ""), hidden: fd.getAll("hidden").map(String) });
    revalidatePath("/setup/invoice-settings");
    return { message: "Form view saved", id: res.id };
  });
}

export async function deleteInvoiceFormViewAction(_p: unknown, fd: FormData) {
  return safeAction(async () => {
    await page.deleteInvoiceFormView(await requireContext(), String(fd.get("brandId") ?? ""), String(fd.get("viewId") ?? ""));
    revalidatePath("/setup/invoice-settings");
    return { message: "Form view deleted" };
  });
}
