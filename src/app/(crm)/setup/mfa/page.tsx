import { profilesForSetup, readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Multi-factor authentication" };

export default async function MfaPage() {
  const { ctx, entry } = await requireSetup("mfa"); // setupPermission: SA
  const [value, profiles] = await Promise.all([readSettingFor(ctx, "mfaPolicy"), profilesForSetup(ctx, "mfa")]);
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Two-step sign-in" hint="Every user can switch on two-step sign-in (authenticator app) under Sign-in security. Here you make it mandatory for whole profiles.">
        <SettingForm settingKey="mfaPolicy" value={value} profiles={profiles} />
      </Section>
    </div>
  );
}
