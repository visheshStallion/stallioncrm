import "server-only";
import { gridFromLines, type GridValue } from "@/components/crm/line-grid";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import type { DocDetail } from "@/server/modules/documents/queries";
import { orderFormData } from "@/server/modules/documents/so-page";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getSetting } from "@/server/modules/setup/service";
import { getUiFilters } from "@/server/request";
import type { OrderValues, SalesOrderFormProps } from "./SalesOrderForm";

export async function orderFormProps(ctx: AccessContext, brandHint?: string | null) {
  const [dir, ui, prefs, company] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx), getSetting("company")]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const brand = brands.find((b) => b.id === brandHint || b.code === brandHint) ?? brands.find((b) => b.id === ui.brandId) ?? (brands.length === 1 ? brands[0] : undefined);
  const pref = (prefs as { dateFormat?: string }).dateFormat;
  const dateFormat = (pref && pref !== "auto" ? pref : (company as { dateFormat: string }).dateFormat) as SalesOrderFormProps["dateFormat"];
  return {
    brands,
    brandId: brand?.id ?? "",
    data: brand ? await orderFormData(ctx, brand.id) : null,
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(dateFormat) ? dateFormat : "DD/MM/YYYY",
    designBrands: ctx.isAdmin ? brands.map((b) => b.id) : (ctx.brandAdminOf ?? []),
    userId: ctx.userId,
  } satisfies Omit<SalesOrderFormProps, "mode">;
}

/** Form values of a stored order (edit) or a copy (clone: no quote link, no VINs). */
export async function orderValues(ctx: AccessContext, doc: DocDetail, clone: boolean): Promise<{ initial: Partial<OrderValues>; initialGrid: GridValue; labels: SalesOrderFormProps["labels"] }> {
  const db = scopedDb(ctx);
  const [contact, quote] = await Promise.all([
    doc.contactId ? db.contact.findUnique({ where: { id: doc.contactId }, select: { id: true, firstName: true, lastName: true } }) : null,
    !clone && doc.sourceDocumentId ? db.quote.findUnique({ where: { id: doc.sourceDocumentId }, select: { id: true, number: true } }) : null,
  ]);
  const o = doc.order!;
  const b = (doc.billTo ?? {}) as Record<string, string | null | undefined>;
  const s = (doc.shipTo ?? {}) as Record<string, string | null | undefined>;
  const grid = gridFromLines(doc.lines, doc);
  if (clone) grid.lines = grid.lines.map(({ id: _id, ...l }, i) => ({ ...l, key: `c${i}`, vins: [] }));
  const str = (x: number) => (x ? String(x) : "");
  return {
    initial: {
      ownerId: doc.ownerId,
      subject: clone ? `${o.subject ?? doc.number} (copy)` : (o.subject ?? ""),
      customerNo: o.customerNo ?? "",
      quoteId: quote?.id ?? "",
      pending: clone ? "" : (o.pending ?? ""),
      carrier: o.carrier ?? "",
      salesCommission: str(o.salesCommission),
      accountId: doc.accountId ?? "",
      customerName: b.name ?? doc.customerName ?? "",
      otherCharges: str(o.otherCharges),
      exchangeRate: String(o.exchangeRate),
      dealId: doc.dealId ?? "",
      customerPoRef: clone ? "" : (o.customerPoRef ?? ""),
      dueDate: clone ? "" : (o.dueDate ?? ""),
      contactId: doc.contactId ?? "",
      exciseDuty: str(o.exciseDuty),
      currency: doc.currency,
      phone: o.phone ?? b.phone ?? "",
      tinNumber: o.tinNumber ?? b.taxId ?? "",
      billTo: { street: b.address ?? "", city: b.city ?? "", state: b.state ?? "", code: b.code ?? "", country: b.country ?? "Nigeria" },
      shipTo: { street: s.address ?? "", city: s.city ?? "", state: s.state ?? "", code: s.code ?? "", country: s.country ?? "Nigeria" },
      terms: doc.terms ?? "",
      description: doc.notes ?? "",
    },
    initialGrid: grid,
    labels: {
      deal: doc.dealId && doc.dealName ? { id: doc.dealId, name: doc.dealName } : null,
      contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") } : null,
      quote: quote ? { id: quote.id, label: quote.number } : null,
    },
  };
}
