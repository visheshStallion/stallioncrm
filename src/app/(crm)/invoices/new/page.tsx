import { forbidden, notFound } from "next/navigation";
import { newLine } from "@/components/crm/line-grid";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { getDocument } from "@/server/modules/documents/queries";
import { requireContext } from "@/server/request";
import { invoiceFormProps, invoiceValues } from "../form-props";
import { InvoiceForm, type InvoiceFormProps, type InvoiceValues } from "../InvoiceForm";

export const metadata = { title: "Create Invoice" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Create Invoice (prompt 26). Pre-fills: `?clone=<invoice>`, `?template=<record template>`, `?dealId=`, and after Save
 * and New `?brand&owner&currency`. A sales order is picked on the form (it copies only what is not invoiced yet).
 */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "invoices", "create")) forbidden();
  const guard = <T,>(p: Promise<T>) =>
    p.catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    });

  let initial: Partial<InvoiceValues> = {};
  let initialGrid: InvoiceFormProps["initialGrid"];
  let labels: InvoiceFormProps["labels"];
  let brandHint = one(sp.brand) ?? null;
  let templateName: string | null = null;
  const cloneId = one(sp.clone);
  if (cloneId) {
    const src = await guard(getDocument(ctx, "invoice", cloneId));
    ({ initial, initialGrid, labels } = await invoiceValues(ctx, src, true));
    brandHint = src.brandId;
  }
  const templateId = one(sp.template);
  if (templateId && !cloneId) {
    const { resolveForUse } = await import("@/server/modules/rectpl/service");
    const t = await guard(resolveForUse(ctx, templateId, "invoices"));
    const products = t.lineItems.length ? await scopedDb(ctx).product.findMany({ where: { id: { in: t.lineItems.map((l) => l.productId) } }, select: { id: true, name: true, category: true } }) : [];
    templateName = t.name;
    brandHint = t.brandId ?? brandHint;
    initial = { terms: (t.values.terms as string | undefined) ?? "", description: (t.values.notes as string | undefined) ?? "" };
    const lines = t.lineItems
      .map((l, i) => ({ l, p: products.find((x) => x.id === l.productId), i }))
      .filter((x) => x.p)
      .map(({ l, p, i }) => newLine({ key: `t${i}`, productId: p!.id, description: p!.name, qty: String(l.qty), discountValue: String(l.discountPct), isStockItem: p!.category === "VEHICLE" }, [{ name: "VAT", rate: 7.5 }]));
    if (lines.length) initialGrid = { lines, header: { discountType: "PERCENT", discountValue: String(t.values.headerDiscountPct ?? 0), taxes: [], adjustment: "0" } };
  }
  const dealId = one(sp.dealId);
  if (dealId && !cloneId) {
    const d = await scopedDb(ctx).deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, brandId: true, customerName: true, accountId: true, account: { select: { name: true, type: true } } } });
    if (d) {
      brandHint = d.brandId;
      initial = { ...initial, dealId: d.id, accountId: d.accountId ?? "", accountType: d.account?.type ?? "", customerName: d.account?.name ?? d.customerName ?? "", subject: d.name };
      labels = { ...labels, deal: { id: d.id, name: d.name } };
    }
  }
  for (const [k, key] of [["owner", "ownerId"], ["currency", "currency"]] as const) {
    const v = one(sp[k]);
    if (v && !cloneId) (initial as Record<string, string>)[key] = v;
  }
  const props = await invoiceFormProps(ctx, brandHint);
  if (initial.currency && initial.currency !== "NGN" && !initial.exchangeRate) initial.exchangeRate = String(props.data?.rates[initial.currency] ?? "");
  return <InvoiceForm key={`${props.brandId}:${cloneId ?? ""}:${templateId ?? ""}:${Date.now()}`} mode={cloneId ? "clone" : "create"} {...props} initial={initial} initialGrid={initialGrid} labels={labels} templateName={templateName} />;
}
