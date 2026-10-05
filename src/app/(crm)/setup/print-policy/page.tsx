import { profilesForSetup, readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Print policy" };

export default async function PrintPolicyPage() {
  const { ctx, entry } = await requireSetup("print-policy"); // setupPermission: ADMIN
  const [value, profiles] = await Promise.all([readSettingFor(ctx, "printPolicy"), profilesForSetup(ctx, "print-policy")]);
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Watermark on list printouts" hint="Lists printed by users of the ticked profiles carry “Internal – name – date” across the page. Single records and documents are not watermarked by this setting; a brand can print COPY on re-printed documents (Letterhead).">
        <SettingForm settingKey="printPolicy" value={value} profiles={profiles} />
      </Section>
    </div>
  );
}
