import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CustomFieldsForm } from "@/components/crm/CustomFields";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { customFormProps } from "@/server/modules/customization/form";
import { createLeadAction } from "@/server/modules/leads/actions";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";
import { LeadFormFields } from "../LeadFormFields";

export const metadata = { title: "Create Lead" };

/** RecordFormPage: sections, 2-column grid, sticky footer [Cancel] [Save and New] [Save]. */
export default async function NewLeadPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "create")) forbidden();
  const [lookups, custom] = await Promise.all([leadFormLookups(ctx), customFormProps(ctx, "leads")]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Lead" />
      <ActionForm action={createLeadAction} className="space-y-4">
        <LeadFormFields lookups={lookups} mode="create" />
        <CustomFieldsForm {...custom} />
        <StickyFormFooter
          cancelHref="/leads"
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
