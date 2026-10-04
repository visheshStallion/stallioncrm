import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { canManageBrandData } from "@/server/access/brand-tag";
import { createProductAction } from "@/server/modules/catalogue/actions";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { ProductFormFields } from "../ProductFormFields";

export const metadata = { title: "Create Product" };

export default async function NewProductPage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  // Only brands whose catalogue the user manages (Brand Manager: own brand; administrator: all).
  const brands = dir.brands.filter((b) => b.status !== "INACTIVE" && canManageBrandData(ctx, "products", "create", b.id));
  if (brands.length === 0) forbidden();
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Product" />
      <ActionForm action={createProductAction} className="space-y-4">
        <ProductFormFields brands={brands} />
        <StickyFormFooter cancelHref="/products">
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
