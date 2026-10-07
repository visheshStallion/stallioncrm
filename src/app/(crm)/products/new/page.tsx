import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { canManageBrandData } from "@/server/access/brand-tag";
import { createProductAction } from "@/server/modules/catalogue/actions";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { ProductFormFields } from "../ProductFormFields";

export const metadata = { title: "Create Product" };

/** Create Product (Zoho-style page): sub-header with Edit Page Layout and [Cancel] [Save and New] [Save]. */
export default async function NewProductPage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  // Only brands whose catalogue the user manages (Brand Manager: own brand; administrator: all).
  const brands = dir.brands.filter((b) => b.status !== "INACTIVE" && canManageBrandData(ctx, "products", "create", b.id));
  if (brands.length === 0) forbidden();
  const lookups = await productFormLookups(ctx, brands.map((b) => b.id));
  return (
    <ActionForm action={createProductAction}>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>Create Product</h1>
          {ctx.isAdmin || (ctx.brandAdminOf ?? []).length ? (
            <Link href="/setup/modules-fields" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href="/products" className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton variant="outline" name="_saveAndNew" value="1">
            Save and New
          </SubmitButton>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <ProductFormFields brands={brands} lookups={lookups} userId={ctx.userId} />
    </ActionForm>
  );
}
