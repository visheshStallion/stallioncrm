import { readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage() {
  const { ctx, entry } = await requireSetup("currencies"); // setupPermission: ADMIN (delegable)
  const value = await readSettingFor(ctx, "currencies");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Currencies and exchange rates">
        <SettingForm settingKey="currencies" value={value} />
      </Section>
    </div>
  );
}
