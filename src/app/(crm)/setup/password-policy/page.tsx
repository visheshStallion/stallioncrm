import { readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Password Policy" };

export default async function PasswordPolicyPage() {
  const { ctx, entry } = await requireSetup("password-policy"); // setupPermission: SA
  const value = await readSettingFor(ctx, "passwordPolicy");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Rules for passwords" hint="Applies when a password is set or changed, and to the lockout after failed sign-ins. Existing passwords stay valid until they are changed or expire.">
        <SettingForm settingKey="passwordPolicy" value={value} />
      </Section>
    </div>
  );
}
