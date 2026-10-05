import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { isAccessError } from "@/server/access/errors";
import { deleteTemplateAction, revertTemplateAction, setTemplateFlagsAction } from "@/server/modules/print/actions";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { designerCatalogue, designerTemplate } from "@/server/modules/print/service";
import { requireSetup } from "../../guard";
import { Section, SetupHeader, fmtDateTime } from "../../_components";
import { Designer } from "../Designer";

export const metadata = { title: "Print template" };

export default async function PrintTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, entry } = await requireSetup("print-templates"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const { id } = await params;
  const t = await designerTemplate(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound(); // another brand's template does not exist for a Brand Admin
    throw e;
  });
  const cat = await designerCatalogue(ctx, t.module);
  const moduleLabel = PRINT_MODULE_OPTIONS.find((m) => m.key === t.module)?.label ?? t.module;
  return (
    <div>
      <SetupHeader
        entry={{ ...entry, label: t.name, description: `${moduleLabel} print template for ${t.brand?.code ?? "all brands"}` }}
        actions={
          <Link href="/setup/print-templates" className="crm-btn crm-btn-secondary">
            All templates
          </Link>
        }
      />
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="template-state">
        {t.version === 0 ? <StatusPill tone="warning">Draft – never published</StatusPill> : <StatusPill tone={t.active ? "success" : "neutral"}>{t.active ? `Published – version ${t.version}` : "Switched off"}</StatusPill>}
        {t.draft && t.version > 0 ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
        {t.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
        <span className="text-text-muted">The designer shows the draft; people print with the published version.</span>
      </p>
      <Designer
        templateId={t.id}
        module={t.module}
        moduleLabel={moduleLabel}
        brandId={t.brandId}
        brandLabel={t.brand?.code ?? "All brands"}
        initial={{ name: t.name, paper: t.paper === "LETTER" ? "LETTER" : "A4", orientation: t.orientation === "landscape" ? "landscape" : "portrait", layout: t.draft ?? t.layout }}
        catalogue={{ sampleId: cat.sampleId, sampleTitle: cat.sampleTitle, fields: cat.fields, lists: cat.lists, hasLines: cat.hasLines, mergeFields: cat.mergeFields }}
        canEdit={t.editable}
        isAdmin={ctx.isAdmin}
      />
      {t.editable ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section title="Version history" hint="Loading a version makes it the draft; publish to print with it again." testId="template-versions">
            {t.versions.length === 0 ? <p className="text-text-muted">Not published yet.</p> : null}
            <ul className="divide-y divide-border">
              {t.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-1.5">
                  <span className="font-bold">Version {v.version}</span>
                  <span className="text-text-muted">{fmtDateTime(v.createdAt)}</span>
                  {v.version === t.version ? (
                    <StatusPill tone="success">current</StatusPill>
                  ) : (
                    <ActionForm action={revertTemplateAction} className="ml-auto">
                      <input type="hidden" name="templateId" value={t.id} />
                      <input type="hidden" name="version" value={v.version} />
                      <Button size="sm" variant="outline" type="submit">
                        Restore as draft
                      </Button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Use" testId="template-flags">
            <div className="flex flex-wrap gap-2">
              {t.version > 0 ? (
                <>
                  <ActionForm action={setTemplateFlagsAction}>
                    <input type="hidden" name="templateId" value={t.id} />
                    <input type="hidden" name="isDefault" value={(!t.isDefault).toString()} />
                    <Button variant="outline" type="submit">
                      {t.isDefault ? "Stop using as the default" : `Make the default for ${t.brand?.code ?? "all brands"}`}
                    </Button>
                  </ActionForm>
                  <ActionForm action={setTemplateFlagsAction}>
                    <input type="hidden" name="templateId" value={t.id} />
                    <input type="hidden" name="active" value={(!t.active).toString()} />
                    <Button variant="outline" type="submit">
                      {t.active ? "Switch off" : "Switch on"}
                    </Button>
                  </ActionForm>
                </>
              ) : null}
              <ActionForm action={deleteTemplateAction} confirm={`Delete the template "${t.name}" and its history?`}>
                <input type="hidden" name="templateId" value={t.id} />
                <Button variant="destructive" type="submit">
                  Delete template
                </Button>
              </ActionForm>
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
