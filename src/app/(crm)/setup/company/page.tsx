import { readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Company Details" };

export default async function CompanyPage() {
  const { ctx, entry } = await requireSetup("company-details"); // setupPermission: SA
  const value = await readSettingFor(ctx, "company");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Group" hint="Group-level details. The legal entity, address and bank details printed on documents belong to each brand (Brands master).">
        <SettingForm settingKey="company" value={value} />
      </Section>
    </div>
  );
}
