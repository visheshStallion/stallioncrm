import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOutEverywhereAction } from "@/server/modules/setup/actions";
import { readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Session settings" };

export default async function SessionsPage() {
  const { ctx, entry } = await requireSetup("session-settings"); // setupPermission: SA
  const value = await readSettingFor(ctx, "sessionPolicy");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Session length">
        <SettingForm settingKey="sessionPolicy" value={value} />
      </Section>
      <Section title="Sign out all sessions of a user" hint="Ends every session of the user on every device at once – for a lost phone or a suspected break-in. They can sign in again straight away." testId="sign-out-everywhere">
        <ActionForm action={signOutEverywhereAction} className="flex flex-wrap items-end gap-3" confirm="Sign this user out on every device?">
          <div className="space-y-1">
            <Label htmlFor="email">User (e-mail)</Label>
            <Input id="email" name="email" type="email" required className="w-72" />
          </div>
          <SubmitButton variant="outline">Sign out everywhere</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
