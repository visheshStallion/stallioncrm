import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CustomFieldsForm } from "@/components/crm/CustomFields";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { customFormProps } from "@/server/modules/customization/form";
import { createDealFormAction } from "@/server/modules/deals/actions";
import { dealFormLookups } from "@/server/modules/deals/queries";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";
import { DealFormFields } from "../DealFormFields";
import { TemplateSlot } from "@/components/crm/TemplateSlot";

export const metadata = { title: "Create Deal" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ accountId?: string; template?: string }> }) {
  const { accountId, template } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "create")) forbidden();
  const [base, extra, custom] = await Promise.all([leadFormLookups(ctx), dealFormLookups(ctx), customFormProps(ctx, "deals")]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Deal" />
      <ActionForm action={createDealFormAction} className="space-y-4">
        <TemplateSlot ctx={ctx} module="deals" templateId={template} clearHref="/deals/new" />
        <DealFormFields
          mode="create"
          canChangeRegion
          values={{ accountId: accountId ?? null }}
          lookups={{ brands: base.brands, regions: base.regions, defaultBrandId: base.defaultBrandId, defaultRegionId: base.defaultRegionId, ...extra }}
        />
        <CustomFieldsForm {...custom} />
        <StickyFormFooter
          cancelHref="/deals"
          saveAndNew={
            <SubmitButton variant="outline" name="_saveAndNew" value="1">
              Save and New
            </SubmitButton>
          }
        >
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
