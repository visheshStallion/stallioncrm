import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createUserAction } from "@/server/modules/admin/actions";
import { adminLookups } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";
import { pickerData } from "../picker-data";
import { TerritoryPicker } from "../TerritoryPicker";
import { UserFields } from "../UserFields";

export const metadata = { title: "New user" };

export default async function NewUserPage() {
  const ctx = await requireContext();
  const lookups = await adminLookups(ctx);
  return (
    <ActionForm action={createUserAction} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>New user</CardTitle>
        </CardHeader>
        <CardContent>
          <UserFields roles={lookups.roles} profiles={lookups.profiles} managers={lookups.activeUsers} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Territories</CardTitle>
        </CardHeader>
        <CardContent>
          <TerritoryPicker {...pickerData(lookups)} initial={[]} />
        </CardContent>
      </Card>
      <SubmitButton>Create user</SubmitButton>
    </ActionForm>
  );
}
