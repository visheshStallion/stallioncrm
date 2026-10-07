import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { isAccessError } from "@/server/access/errors";
import { getVendor } from "@/server/modules/inventory/queries";
import { saveVendorPageAction } from "@/server/modules/inventory/vendor-actions";
import { requireContext } from "@/server/request";
import { vendorFormProps } from "../../data";
import { VendorFields } from "../../VendorFields";

export const metadata = { title: "Edit Vendor" };

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const vendor = await getVendor(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const props = await vendorFormProps(ctx);
  return (
    <ActionForm action={saveVendorPageAction}>
      <input type="hidden" name="id" value={vendor.id} />
      <div className="crm-po-subheader" data-testid="po-subheader">
        <h1>Edit Vendor: {vendor.name}</h1>
        <div className="flex gap-2">
          <Link href={`/vendors/${vendor.id}`} className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <VendorFields {...props} values={vendor} />
    </ActionForm>
  );
}
