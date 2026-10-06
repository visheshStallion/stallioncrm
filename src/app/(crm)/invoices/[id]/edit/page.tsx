import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { getDocument } from "@/server/modules/documents/queries";
import { requireContext } from "@/server/request";
import { invoiceFormProps, invoiceValues } from "../../form-props";
import { InvoiceForm } from "../../InvoiceForm";

export const metadata = { title: "Edit Invoice" };

/** Edit an invoice while it is Created; after that it is corrected with a credit note. */
export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const doc = await getDocument(ctx, "invoice", id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (doc.status !== "DRAFT" || !can(ctx, "invoices", "edit", doc)) redirect(`/invoices/${id}`);
  const props = await invoiceFormProps(ctx, doc.brandId);
  const { initial, initialGrid, labels } = await invoiceValues(ctx, doc, false);
  return <InvoiceForm mode="edit" id={doc.id} number={doc.number} status={doc.status} {...props} initial={initial} initialGrid={initialGrid} labels={labels} />;
}
