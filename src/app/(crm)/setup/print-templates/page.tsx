import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setTemplateFlagsAction } from "@/server/modules/print/actions";
import { BUILTIN_TEMPLATES } from "@/server/modules/print/blocks";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { designerTemplates } from "@/server/modules/print/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "Print templates" };

export default async function PrintTemplatesPage() {
  const { ctx, entry } = await requireSetup("print-templates"); // setupPermission: ADMIN, BRAND_ADMIN (own brand)
  const templates = await designerTemplates(ctx);
  const label = (key: string) => PRINT_MODULE_OPTIONS.find((m) => m.key === key)?.label ?? key;
  return (
    <div>
      <SetupHeader
        entry={entry}
        actions={
          <Link href="/setup/print-templates/new" className="crm-btn crm-btn-primary" data-shortcut="create">
            New print template
          </Link>
        }
      />
      <Section title={`${templates.length} template(s)`} hint="Users choose a template in the print preview. The default of a brand is used when they do not choose; without any template the built-in layout prints." testId="print-templates">
        {templates.length === 0 ? (
          <p className="text-text-muted">No templates yet – every module prints with its built-in layout.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Paper</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Changed</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} data-testid="print-template-row">
                  <TableCell>
                    <Link href={`/setup/print-templates/${t.id}`} className="font-bold text-primary hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>{label(t.module)}</TableCell>
                  <TableCell>{t.brandCode ? <BrandBadge brand={{ code: t.brandCode }} /> : <span className="text-text-muted">All brands</span>}</TableCell>
                  <TableCell>
                    {t.paper === "LETTER" ? "Letter" : "A4"} {t.orientation}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {t.version === 0 ? <StatusPill tone="warning">Draft – never published</StatusPill> : <StatusPill tone={t.active ? "success" : "neutral"}>{t.active ? `Published v${t.version}` : "Switched off"}</StatusPill>}
                      {t.hasDraft && t.version > 0 ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
                      {t.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-text-muted">{fmtDateTime(t.updatedAt)}</TableCell>
                  <TableCell>
                    {t.editable && t.version > 0 ? (
                      <ActionForm action={setTemplateFlagsAction} className="flex justify-end">
                        <input type="hidden" name="templateId" value={t.id} />
                        <input type="hidden" name="isDefault" value={(!t.isDefault).toString()} />
                        <Button size="sm" variant="ghost" type="submit">
                          {t.isDefault ? "Not the default" : "Make default"}
                        </Button>
                      </ActionForm>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Built-in layouts" hint="Always available in the print preview and the starting point of a new template.">
        <ul className="space-y-1">
          {BUILTIN_TEMPLATES.map((b) => (
            <li key={b.key}>
              <strong>{b.name}</strong> <span className="text-text-muted">– {b.modules.includes("*") ? "every module" : b.modules.map(label).join(", ")}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
