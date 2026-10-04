import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { createDealFormAction } from "@/server/modules/deals/actions";
import { dealFormLookups } from "@/server/modules/deals/queries";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";
import { DealFormFields } from "../DealFormFields";

export const metadata = { title: "Create Deal" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  const { accountId } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "deals", "create")) forbidden();
  const [base, extra] = await Promise.all([leadFormLookups(ctx), dealFormLookups(ctx)]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Deal" />
      <ActionForm action={createDealFormAction} className="space-y-4">
        <DealFormFields
          mode="create"
          canChangeRegion
          values={{ accountId: accountId ?? null }}
          lookups={{ brands: base.brands, regions: base.regions, defaultBrandId: base.defaultBrandId, defaultRegionId: base.defaultRegionId, ...extra }}
        />
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
