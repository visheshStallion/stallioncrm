import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { canManageBrandData } from "@/server/access/brand-tag";
import { isAccessError } from "@/server/access/errors";
import { updateProductAction } from "@/server/modules/catalogue/actions";
import { getProduct, productFormLookups } from "@/server/modules/catalogue/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { ProductFormFields } from "../../ProductFormFields";

export const metadata = { title: "Edit Product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const product = await getProduct(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (!canManageBrandData(ctx, "products", "edit", product.brandId)) forbidden();
  const [dir, lookups] = await Promise.all([getDirectory(ctx), productFormLookups(ctx, [product.brandId])]);
  return (
    <ActionForm action={updateProductAction}>
      <input type="hidden" name="id" value={product.id} />
      <div className="crm-po-subheader" data-testid="po-subheader">
        <h1>Edit Product: {product.name}</h1>
        <div className="flex gap-2">
          <Link href={`/products/${product.id}`} className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <ProductFormFields values={product} brands={dir.brands} lookups={lookups} userId={ctx.userId} />
    </ActionForm>
  );
}
