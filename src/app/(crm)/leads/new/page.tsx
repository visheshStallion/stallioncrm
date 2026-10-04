import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/server/access/can";
import { createLeadAction } from "@/server/modules/leads/actions";
import { leadFormLookups } from "@/server/modules/leads/queries";
import { requireContext } from "@/server/request";
import { LeadFormFields } from "../LeadFormFields";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "leads", "create")) forbidden();
  const lookups = await leadFormLookups(ctx);
  return (
    <Card>
      <CardHeader>
        <CardTitle>New lead</CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm action={createLeadAction} className="space-y-4">
          <LeadFormFields lookups={lookups} mode="create" />
          <SubmitButton>Create lead</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
