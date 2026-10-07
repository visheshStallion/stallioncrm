import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { getDocument } from "@/server/modules/documents/queries";
import { requireContext } from "@/server/request";
import { quoteFormProps, quoteValues } from "../../form-props";
import { QuoteForm } from "../../QuoteForm";

export const metadata = { title: "Edit Quote" };

/** Edit a draft quote on the Create Quote page (submitted quotes are revised first). */
export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const doc = await getDocument(ctx, "quote", id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (doc.status !== "DRAFT" || !can(ctx, "quotes", "edit", doc)) redirect(`/quotes/${id}`);
  const props = await quoteFormProps(ctx, doc.brandId);
  const { initial, initialGrid, labels } = await quoteValues(ctx, doc, false);
  return <QuoteForm mode="edit" id={doc.id} number={doc.number} status={doc.status} {...props} initial={initial} initialGrid={initialGrid} labels={labels} />;
}
