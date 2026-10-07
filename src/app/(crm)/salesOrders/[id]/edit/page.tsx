import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { getDocument } from "@/server/modules/documents/queries";
import { requireContext } from "@/server/request";
import { orderFormProps, orderValues } from "../../form-props";
import { SalesOrderForm } from "../../SalesOrderForm";

export const metadata = { title: "Edit Sales Order" };

/** Edit a sales order while it is Created; a confirmed one is reopened by a Brand Manager first. */
export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const doc = await getDocument(ctx, "salesOrder", id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (doc.status !== "DRAFT" || !can(ctx, "salesOrders", "edit", doc)) redirect(`/salesOrders/${id}`);
  const props = await orderFormProps(ctx, doc.brandId);
  const { initial, initialGrid, labels } = await orderValues(ctx, doc, false);
  return <SalesOrderForm mode="edit" id={doc.id} number={doc.number} status={doc.status} {...props} initial={initial} initialGrid={initialGrid} labels={labels} />;
}
