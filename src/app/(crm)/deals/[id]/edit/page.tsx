import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { CustomFieldsForm } from "@/components/crm/CustomFields";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { isManagerOf } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";
import { customFormProps, storedCustomValues } from "@/server/modules/customization/form";
import { updateDealFormAction } from "@/server/modules/deals/actions";
import { dealFormLookups, getDeal } from "@/server/modules/deals/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { DealFormFields } from "../../DealFormFields";

export const metadata = { title: "Edit Deal" };

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const deal = await getDeal(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (!can(ctx, "deals", "edit", deal)) forbidden();
  const [dir, extra, custom, stored] = await Promise.all([getDirectory(ctx), dealFormLookups(ctx), customFormProps(ctx, "deals"), scopedDb(ctx).deal.findUnique({ where: { id }, select: { customFields: true } })]);
  const brand = dir.brands.find((b) => b.id === deal.brandId);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit Deal: ${deal.name}`} left={<BrandBadge brand={brand} />} />
      <ActionForm action={updateDealFormAction} className="space-y-4">
        <input type="hidden" name="id" value={deal.id} />
        <DealFormFields
          mode="edit"
          values={deal}
          canChangeRegion={isManagerOf(ctx, deal.brandId, deal.regionId)}
          lookups={{ brands: dir.brands, regions: dir.regions, defaultBrandId: null, defaultRegionId: null, ...extra }}
        />
        <CustomFieldsForm {...custom} fixedBrandId={deal.brandId} values={storedCustomValues(stored)} />
        <StickyFormFooter cancelHref={`/deals/${deal.id}`}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
