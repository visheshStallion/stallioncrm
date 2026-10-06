import { forbidden, redirect } from "next/navigation";
import { hasPermission } from "@/server/access/can";
import { getPurchaseOrder } from "@/server/modules/inventory/purchase-orders";
import { requireContext } from "@/server/request";
import { formProps, valuesOf } from "../../form-props";
import { PurchaseOrderForm } from "../../PurchaseOrderForm";

export const metadata = { title: "Edit Purchase Order" };

/** Edit a PO while it is Created; approved ones are locked (the record page offers Reopen to managers). */
export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "inventory", "edit")) forbidden();
  const po = await getPurchaseOrder(ctx, id);
  if (po.status !== "DRAFT") redirect(`/purchaseOrders/${id}`);
  const props = await formProps(ctx, { po });
  const { initial, initialGrid } = valuesOf(po, false);
  return <PurchaseOrderForm mode="edit" id={po.id} number={po.number} status={po.status} {...props} initial={initial} initialGrid={initialGrid} />;
}
