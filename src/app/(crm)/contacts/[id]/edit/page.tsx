import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { tierAtLeast } from "@/server/access/customer-tier";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { updateContactAction } from "@/server/modules/customers/actions";
import { getContact } from "@/server/modules/customers/queries";
import { requireContext } from "@/server/request";
import { ContactFormFields } from "../../ContactFormFields";

export const metadata = { title: "Edit Contact" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "contacts", "edit")) forbidden();
  const contact = await getContact(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const accounts = await scopedDb(ctx).account.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 });
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit Contact: ${contact.name}`} />
      <ActionForm action={updateContactAction} className="space-y-4">
        <input type="hidden" name="id" value={contact.id} />
        <ContactFormFields values={contact} accounts={accounts} contactTier={tierAtLeast(contact.tier, "CONTACT")} />
        <StickyFormFooter cancelHref={`/contacts/${contact.id}`}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
