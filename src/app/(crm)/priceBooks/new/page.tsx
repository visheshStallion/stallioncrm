import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { canManageBrandData } from "@/server/access/brand-tag";
import { createPriceBookAction } from "@/server/modules/catalogue/actions";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { PriceBookFields } from "../PriceBookFields";

export const metadata = { title: "Create Price Book" };

/** Create Price Book (Zoho-style page): sub-header with [Cancel] [Save and New] [Save]. */
export default async function NewPriceBookPage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  const brands = dir.brands.filter((b) => b.status !== "INACTIVE" && canManageBrandData(ctx, "priceBooks", "create", b.id)).map((b) => ({ id: b.id, code: b.code, name: b.name }));
  if (!brands.length) forbidden();
  const lookups = await productFormLookups(ctx, brands.map((b) => b.id));
  return (
    <ActionForm action={createPriceBookAction}>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>Create Price Book</h1>
          {ctx.isAdmin ? (
            <Link href="/setup/modules-fields" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href="/priceBooks" className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton variant="outline" name="_saveAndNew" value="1">
            Save and New
          </SubmitButton>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <PriceBookFields brands={brands} owners={lookups.owners} userId={ctx.userId} today={new Date().toISOString().slice(0, 10)} />
    </ActionForm>
  );
}
