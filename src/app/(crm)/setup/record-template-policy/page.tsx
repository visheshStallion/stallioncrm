import Link from "next/link";
import { readSettingFor } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, SettingForm } from "../_components";

export const metadata = { title: "Record template policy" };

export default async function RecordTemplatePolicyPage() {
  const { ctx, entry } = await requireSetup("record-template-policy"); // setupPermission: ADMIN
  const value = await readSettingFor(ctx, "recordTemplatePolicy");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Create from a template only" hint="For a ticked module the blank create form and the create API are refused: users choose a published record template first. Imports, web forms and conversions are not affected.">
        <SettingForm settingKey="recordTemplatePolicy" value={value} />
        <p className="text-sm">
          Record templates are managed in the{" "}
          <Link href="/templates?tab=record" className="text-primary underline">
            Templates hub
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
