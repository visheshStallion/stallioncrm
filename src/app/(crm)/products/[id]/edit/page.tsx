import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { canManageBrandData } from "@/server/access/brand-tag";
import { isAccessError } from "@/server/access/errors";
import { updateProductAction } from "@/server/modules/catalogue/actions";
import { getProduct } from "@/server/modules/catalogue/queries";
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
  const dir = await getDirectory(ctx);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit Product: ${product.name}`} />
      <ActionForm action={updateProductAction} className="space-y-4">
        <input type="hidden" name="id" value={product.id} />
        <ProductFormFields values={product} brands={dir.brands} />
        <StickyFormFooter cancelHref={`/products/${product.id}`}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
