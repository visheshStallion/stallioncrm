import "server-only";
import { gridFromLines, type GridValue } from "@/components/crm/line-grid";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import type { DocDetail } from "@/server/modules/documents/queries";
import { quoteFormData } from "@/server/modules/documents/quote-page";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getSetting } from "@/server/modules/setup/service";
import { getUiFilters } from "@/server/request";
import type { QuoteFormProps, QuoteValues } from "./QuoteForm";

/** Brands, lookups of the chosen brand, date format and who may design the page. */
export async function quoteFormProps(ctx: AccessContext, brandHint?: string | null) {
  const [dir, ui, prefs, company] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx), getSetting("company")]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const brand = brands.find((b) => b.id === brandHint || b.code === brandHint) ?? brands.find((b) => b.id === ui.brandId) ?? (brands.length === 1 ? brands[0] : undefined);
  const pref = (prefs as { dateFormat?: string }).dateFormat;
  const dateFormat = (pref && pref !== "auto" ? pref : (company as { dateFormat: string }).dateFormat) as QuoteFormProps["dateFormat"];
  return {
    brands,
    brandId: brand?.id ?? "",
    data: brand ? await quoteFormData(ctx, brand.id) : null,
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(dateFormat) ? dateFormat : "DD/MM/YYYY",
    designBrands: ctx.isAdmin ? brands.map((b) => b.id) : (ctx.brandAdminOf ?? []),
    today: new Date().toISOString().slice(0, 10),
    userId: ctx.userId,
  } satisfies Omit<QuoteFormProps, "mode">;
}

/** Form values of a stored quote (edit) or a copy (clone: today's dates, no deal link kept). */
export async function quoteValues(ctx: AccessContext, doc: DocDetail, clone: boolean): Promise<{ initial: Partial<QuoteValues>; initialGrid: GridValue; labels: QuoteFormProps["labels"] }> {
  const contact = doc.contactId ? await scopedDb(ctx).contact.findUnique({ where: { id: doc.contactId }, select: { id: true, firstName: true, lastName: true } }) : null;
  const q = doc.quote!;
  const b = (doc.billTo ?? {}) as Record<string, string | null | undefined>;
  const grid = gridFromLines(doc.lines, doc);
  if (clone) grid.lines = grid.lines.map(({ id: _id, ...l }, i) => ({ ...l, key: `c${i}` }));
  return {
    initial: {
      ownerId: doc.ownerId,
      subject: clone ? `${q.subject ?? doc.number} (copy)` : (q.subject ?? ""),
      orgName: q.orgName ?? "",
      orgAddress: q.orgAddress ?? "",
      orgCity: q.orgCity ?? "",
      orgCountry: q.orgCountry ?? "Nigeria",
      tinNumber: q.tinNumber ?? "",
      phone: q.phone ?? b.phone ?? "",
      email: q.email ?? b.email ?? "",
      quoteDate: clone ? undefined : doc.issueDate,
      validUntil: clone ? undefined : (doc.date ?? ""),
      currency: doc.currency,
      exchangeRate: String(q.exchangeRate),
      dealId: doc.dealId ?? "",
      accountId: doc.accountId ?? "",
      customerName: b.name ?? doc.customerName ?? "",
      contactId: doc.contactId ?? "",
      billTo: { street: b.address ?? "", city: b.city ?? "", state: b.state ?? "", country: b.country ?? "Nigeria" },
      terms: doc.terms ?? "",
      description: doc.notes ?? "",
    },
    initialGrid: grid,
    labels: { contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") } : null, deal: doc.dealId && doc.dealName ? { id: doc.dealId, name: doc.dealName } : null },
  };
}
