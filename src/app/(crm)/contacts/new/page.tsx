import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { createContactAction } from "@/server/modules/customers/actions";
import { requireContext } from "@/server/request";
import { ContactFormFields } from "../ContactFormFields";
import { TemplateSlot } from "@/components/crm/TemplateSlot";

export const metadata = { title: "Create Contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string; template?: string }> }) {
  const { accountId, template } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "contacts", "create")) forbidden();
  const accounts = await scopedDb(ctx).account.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 });
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Contact" />
      <ActionForm action={createContactAction} className="space-y-4">
        <TemplateSlot ctx={ctx} module="contacts" templateId={template} clearHref="/contacts/new" />
        <ContactFormFields accounts={accounts} values={{ accountId: accountId ?? null }} contactTier />
        <StickyFormFooter
          cancelHref="/contacts"
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
