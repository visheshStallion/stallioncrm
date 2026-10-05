import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { createAccountAction } from "@/server/modules/customers/actions";
import { requireContext } from "@/server/request";
import { AccountFormFields } from "../AccountFormFields";
import { TemplateSlot } from "@/components/crm/TemplateSlot";

export const metadata = { title: "Create Account" };

export default async function NewAccountPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "accounts", "create")) forbidden();
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Account" />
      <ActionForm action={createAccountAction} className="space-y-4">
        <TemplateSlot ctx={ctx} module="accounts" templateId={template} clearHref="/accounts/new" />
        <AccountFormFields contactTier sensitiveTier={ctx.scope === "ALL"} />
        <StickyFormFooter
          cancelHref="/accounts"
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
