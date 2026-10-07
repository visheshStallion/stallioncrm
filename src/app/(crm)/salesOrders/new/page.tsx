import { forbidden, notFound } from "next/navigation";
import { newLine } from "@/components/crm/line-grid";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { getDocument } from "@/server/modules/documents/queries";
import { requireContext } from "@/server/request";
import { orderFormProps, orderValues } from "../form-props";
import { SalesOrderForm, type OrderValues, type SalesOrderFormProps } from "../SalesOrderForm";

export const metadata = { title: "Create Sales Order" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Create Sales Order. Pre-fills: `?clone=`, `?template=`, `?dealId=`, and after Save and New `?brand&owner&currency&carrier`. */
export default async function NewSalesOrderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "salesOrders", "create")) forbidden();
  const guard = <T,>(p: Promise<T>) =>
    p.catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    });
  let initial: Partial<OrderValues> = {};
  let initialGrid: SalesOrderFormProps["initialGrid"];
  let labels: SalesOrderFormProps["labels"];
  let brandHint = one(sp.brand) ?? null;
  let templateName: string | null = null;
  const cloneId = one(sp.clone);
  if (cloneId) {
    const src = await guard(getDocument(ctx, "salesOrder", cloneId));
    ({ initial, initialGrid, labels } = await orderValues(ctx, src, true));
    brandHint = src.brandId;
  }
  const templateId = one(sp.template);
  if (templateId && !cloneId) {
    const { resolveForUse } = await import("@/server/modules/rectpl/service");
    const t = await guard(resolveForUse(ctx, templateId, "salesOrders"));
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
    const d = await scopedDb(ctx).deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, brandId: true, customerName: true, accountId: true, account: { select: { name: true } } } });
    if (d) {
      brandHint = d.brandId;
      initial = { ...initial, dealId: d.id, accountId: d.accountId ?? "", customerName: d.account?.name ?? d.customerName ?? "", subject: d.name };
      labels = { ...labels, deal: { id: d.id, name: d.name } };
    }
  }
  for (const [k, key] of [["owner", "ownerId"], ["currency", "currency"], ["carrier", "carrier"]] as const) {
    const v = one(sp[k]);
    if (v && !cloneId) (initial as Record<string, string>)[key] = v;
  }
  const props = await orderFormProps(ctx, brandHint);
  if (initial.currency && initial.currency !== "NGN" && !initial.exchangeRate) initial.exchangeRate = String(props.data?.rates[initial.currency] ?? "");
  return <SalesOrderForm key={`${props.brandId}:${cloneId ?? ""}:${templateId ?? ""}:${Date.now()}`} mode={cloneId ? "clone" : "create"} {...props} initial={initial} initialGrid={initialGrid} labels={labels} templateName={templateName} />;
}
