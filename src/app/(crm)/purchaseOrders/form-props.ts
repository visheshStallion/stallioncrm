import "server-only";
import { gridFromLines, type GridValue } from "@/components/crm/line-grid";
import type { AccessContext } from "@/server/access/types";
import { getPurchaseOrder, poFormData } from "@/server/modules/inventory/purchase-orders";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getSetting } from "@/server/modules/setup/service";
import { getUiFilters } from "@/server/request";
import type { PoValues, PurchaseOrderFormProps } from "./PurchaseOrderForm";

/** Brands, lookups of the chosen brand, date format and who may design the page – for create / edit / clone. */
export async function formProps(ctx: AccessContext, opts: { brand?: string; po?: Awaited<ReturnType<typeof getPurchaseOrder>> | null; keep?: Partial<PoValues> }) {
  const [dir, ui, prefs, company] = await Promise.all([getDirectory(ctx), getUiFilters(ctx), getPreferences(ctx), getSetting("company")]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const brand = (opts.po ? brands.find((b) => b.id === opts.po!.brandId) : null) ?? brands.find((b) => b.id === opts.brand || b.code === opts.brand) ?? brands.find((b) => b.id === ui.brandId) ?? (brands.length === 1 ? brands[0] : undefined);
  const data = brand ? await poFormData(ctx, brand.id) : null;
  const pref = (prefs as { dateFormat?: string }).dateFormat;
  const dateFormat = (pref && pref !== "auto" ? pref : (company as { dateFormat: string }).dateFormat) as PurchaseOrderFormProps["dateFormat"];
  return {
    brands,
    brandId: brand?.id ?? "",
    data,
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(dateFormat) ? dateFormat : "DD/MM/YYYY",
    designBrands: ctx.isAdmin ? brands.map((b) => b.id) : (ctx.brandAdminOf ?? []),
    today: new Date().toISOString().slice(0, 10),
    userId: ctx.userId,
  } satisfies Omit<PurchaseOrderFormProps, "mode">;
}

/** Form values and grid of a stored PO (edit) or of a copy (clone: no number, today's date, status Created). */
export function valuesOf(po: Awaited<ReturnType<typeof getPurchaseOrder>>, clone: boolean): { initial: Partial<PoValues>; initialGrid: GridValue } {
  const lines = po.lines.map((l) => ({ ...l, id: clone ? `c${l.id}` : l.id }));
  const grid = gridFromLines(lines, po);
  if (clone) grid.lines = grid.lines.map(({ id: _id, ...l }) => l);
  return {
    initial: {
      ownerId: po.owner?.id ?? "",
      subject: clone ? `${po.subject} (copy)` : po.subject,
      requisitionNumber: po.requisitionNumber ?? "",
      vendorId: po.vendor?.id ?? "",
      vendorContactId: po.contact?.id ?? "",
      trackingNumber: clone ? "" : (po.trackingNumber ?? ""),
      poDate: clone ? new Date().toISOString().slice(0, 10) : po.poDate,
      dueDate: clone ? "" : (po.dueDate ?? ""),
      carrier: po.carrier ?? "",
      exciseDuty: po.exciseDuty ? String(po.exciseDuty) : "",
      salesCommission: po.salesCommission ? String(po.salesCommission) : "",
      currency: po.currency,
      exchangeRate: String(po.exchangeRate),
      billTo: po.billTo,
      shipTo: po.shipTo,
      warehouseId: po.warehouse?.id ?? "",
      terms: po.terms ?? "",
      description: po.description ?? "",
      formViewId: po.formViewId ?? "",
    },
    initialGrid: grid,
  };
}
