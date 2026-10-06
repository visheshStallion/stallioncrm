import "server-only";
import { gridFromLines, type GridValue } from "@/components/crm/line-grid";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { invoiceFormData } from "@/server/modules/documents/invoice-page";
import type { DocDetail } from "@/server/modules/documents/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getSetting } from "@/server/modules/setup/service";
import { getUiFilters } from "@/server/request";
import type { InvoiceFormProps, InvoiceValues } from "./InvoiceForm";

/** Brands, lookups of the chosen brand, date format and who may design the page – for create / edit / clone. */
export async function invoiceFormProps(ctx: AccessContext, brandHint?: string | null) {
  const [dir, ui, prefs, company] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx), getSetting("company")]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const brand = brands.find((b) => b.id === brandHint || b.code === brandHint) ?? brands.find((b) => b.id === ui.brandId) ?? (brands.length === 1 ? brands[0] : undefined);
  const pref = (prefs as { dateFormat?: string }).dateFormat;
  const dateFormat = (pref && pref !== "auto" ? pref : (company as { dateFormat: string }).dateFormat) as InvoiceFormProps["dateFormat"];
  return {
    brands,
    brandId: brand?.id ?? "",
    data: brand ? await invoiceFormData(ctx, brand.id) : null,
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(dateFormat) ? dateFormat : "DD/MM/YYYY",
    designBrands: ctx.isAdmin ? brands.map((b) => b.id) : (ctx.brandAdminOf ?? []),
    today: new Date().toISOString().slice(0, 10),
    userId: ctx.userId,
  } satisfies Omit<InvoiceFormProps, "mode">;
}

/** Form values of a stored invoice (edit) or of a copy (clone: today's dates, no sales order, no number). */
export async function invoiceValues(ctx: AccessContext, doc: DocDetail, clone: boolean): Promise<{ initial: Partial<InvoiceValues>; initialGrid: GridValue; labels: InvoiceFormProps["labels"] }> {
  const db = scopedDb(ctx);
  const [account, contact, order] = await Promise.all([
    doc.accountId ? db.account.findUnique({ where: { id: doc.accountId }, select: { type: true } }) : null,
    doc.contactId ? db.contact.findUnique({ where: { id: doc.contactId }, select: { id: true, firstName: true, lastName: true } }) : null,
    !clone && doc.sourceDocumentId ? db.salesOrder.findUnique({ where: { id: doc.sourceDocumentId }, select: { id: true, number: true } }) : null,
  ]);
  const inv = doc.invoice!;
  const b = (doc.billTo ?? {}) as Record<string, string | null | undefined>;
  const s = (doc.shipTo ?? {}) as Record<string, string | null | undefined>;
  const grid = gridFromLines(doc.lines, doc);
  if (clone) grid.lines = grid.lines.map(({ id: _id, sourceLineId: _s, ...l }, i) => ({ ...l, key: `c${i}` }));
  const str = (x: number) => (x ? String(x) : "");
  return {
    initial: {
      ownerId: doc.ownerId,
      subject: clone ? `${inv.subject ?? doc.number} (copy)` : (inv.subject ?? ""),
      customerPoRef: clone ? "" : (inv.customerPoRef ?? ""),
      invoiceDate: clone ? undefined : doc.issueDate,
      dueDate: clone ? undefined : (doc.date ?? ""),
      salesCommission: str(inv.salesCommission),
      exciseDuty: str(inv.exciseDuty),
      otherCharges: str(inv.otherCharges),
      tinNumber: inv.tinNumber ?? "",
      currency: doc.currency,
      exchangeRate: String(inv.exchangeRate),
      accountId: doc.accountId ?? "",
      accountType: account?.type ?? "",
      customerName: b.name ?? doc.customerName ?? "",
      contactId: doc.contactId ?? "",
      phone: inv.phone ?? b.phone ?? "",
      dealId: doc.dealId ?? "",
      salesOrderId: clone ? "" : (order?.id ?? ""),
      billTo: { street: b.address ?? "", city: b.city ?? "", state: b.state ?? "", code: b.code ?? "", country: b.country ?? "Nigeria" },
      shipTo: { street: s.address ?? "", city: s.city ?? "", state: s.state ?? "", code: s.code ?? "", country: s.country ?? "Nigeria" },
      terms: doc.terms ?? "",
      description: doc.notes ?? "",
      formViewId: inv.formViewId ?? "",
    },
    initialGrid: grid,
    labels: {
      deal: doc.dealId && doc.dealName ? { id: doc.dealId, name: doc.dealName } : null,
      contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") } : null,
      order: order ? { id: order.id, number: order.number } : null,
    },
  };
}
