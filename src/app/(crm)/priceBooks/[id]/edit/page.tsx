import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { canManageBrandData } from "@/server/access/brand-tag";
import { updatePriceBookAction } from "@/server/modules/catalogue/actions";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { scopedDb } from "@/server/db";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { PriceBookFields } from "../../PriceBookFields";

export const metadata = { title: "Edit Price Book" };

export default async function EditPriceBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const book = await scopedDb(ctx).priceBook.findUnique({ where: { id } });
  if (!book) notFound();
  if (!canManageBrandData(ctx, "priceBooks", "edit", book.brandId)) forbidden();
  const [dir, lookups] = await Promise.all([getDirectory(ctx), productFormLookups(ctx, [book.brandId])]);
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  return (
    <ActionForm action={updatePriceBookAction}>
      <input type="hidden" name="id" value={book.id} />
      <div className="crm-po-subheader" data-testid="po-subheader">
        <h1>Edit Price Book: {book.name}</h1>
        <div className="flex gap-2">
          <Link href={`/priceBooks/${book.id}`} className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <PriceBookFields
        brands={dir.brands.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        owners={lookups.owners}
        userId={ctx.userId}
        today={new Date().toISOString().slice(0, 10)}
        values={{ id: book.id, brandId: book.brandId, ownerId: book.ownerId, name: book.name, active: book.active, pricingModel: book.pricingModel, naira: book.naira === null ? null : Number(book.naira), validFrom: d(book.validFrom)!, validTo: d(book.validTo), isDefault: book.isDefault, description: book.description }}
      />
    </ActionForm>
  );
}
