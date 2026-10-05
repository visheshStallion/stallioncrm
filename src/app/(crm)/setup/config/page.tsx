import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Label } from "@/components/ui/label";
import { importConfigurationAction } from "@/server/modules/setup/actions";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Configuration export / import" };

export default async function ConfigPage() {
  const { entry } = await requireSetup("config-as-code"); // setupPermission: SA
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Export" hint="One JSON document: settings, roles, profiles (permissions, field access, setup permissions), validation rules, custom fields, layouts and pipelines. Brands are referred to by code; no users, no business data, no secrets." testId="config-export">
        <a href="/api/v1/setup/config" className="crm-btn crm-btn-secondary" download>
          Download configuration (JSON)
        </a>
      </Section>
      <Section
        title="Import"
        hint="Validates first: structure, setting values, brand codes, role parents and formulas. If anything is wrong nothing is changed. A valid document is applied as a whole: roles, profiles, custom fields and pipelines are updated by name and created when missing (never deleted); settings, validation rules and layouts are replaced as a set."
        testId="config-import"
      >
        <ActionForm action={importConfigurationAction} className="space-y-3" confirm={undefined}>
          <div className="space-y-1">
            <Label htmlFor="file">Configuration file</Label>
            <input id="file" name="file" type="file" accept="application/json,.json" className="block text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="json">…or paste the JSON</Label>
            <textarea id="json" name="json" rows={8} className="crm-input font-mono" spellCheck={false} />
          </div>
          <div className="flex justify-end gap-2">
            <SubmitButton variant="outline" name="_intent" value="validate">
              Validate only
            </SubmitButton>
            <SubmitButton name="_intent" value="import">
              Import
            </SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
