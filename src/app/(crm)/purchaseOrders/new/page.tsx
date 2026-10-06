import { forbidden } from "next/navigation";
import { hasPermission } from "@/server/access/can";
import { getPurchaseOrder } from "@/server/modules/inventory/purchase-orders";
import { requireContext } from "@/server/request";
import { formProps, valuesOf } from "../form-props";
import { PurchaseOrderForm } from "../PurchaseOrderForm";

export const metadata = { title: "Create Purchase Order" };

/**
 * Create Purchase Order (prompt 25). `?clone=<id>` copies a PO; Save and New comes back with `?brand&owner&vendor
 * &currency&carrier` so those stay filled.
 */
export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "inventory", "create")) forbidden();
  const source = sp.clone ? await getPurchaseOrder(ctx, sp.clone) : null;
  const props = await formProps(ctx, { brand: source?.brandId ?? sp.brand, po: source });
  const clone = source ? valuesOf(source, true) : null;
  const keep = { ownerId: sp.owner, vendorId: sp.vendor, currency: sp.currency, carrier: sp.carrier };
  const initial: Record<string, string> = (clone?.initial as Record<string, string> | undefined) ?? Object.fromEntries(Object.entries(keep).filter((e): e is [string, string] => !!e[1]));
  if (!clone && sp.currency && sp.currency !== "NGN") Object.assign(initial, { exchangeRate: String(props.data?.rates[sp.currency] ?? "") });
  return <PurchaseOrderForm key={`${props.brandId}:${sp.clone ?? ""}:${sp.vendor ?? ""}:${Date.now()}`} mode={clone ? "clone" : "create"} {...props} initial={initial} initialGrid={clone?.initialGrid} />;
}
