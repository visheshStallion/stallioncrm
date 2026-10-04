import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { tierAtLeast } from "@/server/access/customer-tier";
import { isAccessError } from "@/server/access/errors";
import { updateAccountAction } from "@/server/modules/customers/actions";
import { getAccount } from "@/server/modules/customers/queries";
import { requireContext } from "@/server/request";
import { AccountFormFields } from "../../AccountFormFields";

export const metadata = { title: "Edit Account" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "accounts", "edit")) forbidden();
  const account = await getAccount(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit Account: ${account.name}`} />
      <ActionForm action={updateAccountAction} className="space-y-4">
        <input type="hidden" name="id" value={account.id} />
        <AccountFormFields values={account} contactTier={tierAtLeast(account.tier, "CONTACT")} sensitiveTier={tierAtLeast(account.tier, "SENSITIVE")} />
        <StickyFormFooter cancelHref={`/accounts/${account.id}`}>
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
