import { readSettingFor } from "@/server/modules/setup/service";
import { fiscalPeriod } from "@/server/modules/setup/settings";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Fiscal Year" };

export default async function FiscalYearPage() {
  const { ctx, entry } = await requireSetup("fiscal-year"); // setupPermission: ADMIN (delegable)
  const value = await readSettingFor(ctx, "fiscalYear");
  const today = fiscalPeriod(new Date(), value.startMonth);
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Financial year">
        <SettingForm settingKey="fiscalYear" value={value} />
        <p className="text-text-muted" data-testid="fiscal-today">
          Today is in quarter {today.quarter} of financial year {today.year}.
        </p>
      </Section>
    </div>
  );
}
