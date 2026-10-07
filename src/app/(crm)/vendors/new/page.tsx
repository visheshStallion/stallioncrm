import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { saveVendorPageAction } from "@/server/modules/inventory/vendor-actions";
import { requireContext } from "@/server/request";
import { vendorFormProps } from "../data";
import { VendorFields } from "../VendorFields";

export const metadata = { title: "Create Vendor" };

/** Create Vendor (Zoho-style page): sub-header with [Cancel] [Save and New] [Save]. */
export default async function NewVendorPage() {
  const ctx = await requireContext();
  const props = await vendorFormProps(ctx);
  return (
    <ActionForm action={saveVendorPageAction}>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>Create Vendor</h1>
          {ctx.isAdmin ? (
            <Link href="/setup/modules-fields" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href="/vendors" className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton variant="outline" name="_saveAndNew" value="1">
            Save and New
          </SubmitButton>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <VendorFields {...props} />
    </ActionForm>
  );
}
