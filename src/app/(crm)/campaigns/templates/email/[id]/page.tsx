import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { isAccessError } from "@/server/access/errors";
import { restoreTemplateVersionAction } from "@/server/modules/email/actions";
import { TEMPLATE_FIELDS, richTemplate, templateBrands, templateDiff } from "@/server/modules/email/templates";
import { requireContext } from "@/server/request";
import { TemplateEditor } from "../TemplateEditor";

export const metadata = { title: "E-mail template" };

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(d);

/** Rich editor of one e-mail template, its versions (`?diff=<n>` compares one with the current) and where it is used. */
export default async function EmailTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ diff?: string }> }) {
  const [{ id }, { diff }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  const t = await richTemplate(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound(); // another brand's template does not exist here
    throw e;
  });
  const version = diff && /^\d+$/.test(diff) ? Number(diff) : null;
  const [{ brands, group }, lines] = await Promise.all([templateBrands(ctx), version ? templateDiff(ctx, id, version).catch(() => null) : null]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title={t.name}
        left={
          <>
            <Link href="/campaigns/templates" className="text-sm text-primary hover:underline">
              ← Templates
            </Link>
            <StatusPill tone={t.active ? "success" : "neutral"}>{t.active ? `Active – version ${t.version}` : "Inactive"}</StatusPill>
            <StatusPill tone="neutral">{t.brand?.code ?? "Group"}</StatusPill>
          </>
        }
      />
      <TemplateEditor
        key={t.version}
        templateId={t.id}
        brandId={t.brandId}
        brands={t.brandId ? [{ id: t.brandId, label: `${t.brand?.code} – ${t.brand?.name}` }] : brands}
        group={group}
        initial={{ name: t.name, module: t.module, folder: t.folder, category: t.category ?? "Sales", subject: t.subject ?? "", doc: t.doc, active: t.active }}
        mergeFields={TEMPLATE_FIELDS}
        canEdit={t.editable}
        allowHtml={ctx.isAdmin}
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="template-versions">
          <h2 className="mb-2 text-[13px] font-semibold">Versions</h2>
          {t.versions.length ? (
            <ul className="space-y-1 text-sm">
              {t.versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Version {v.version}</span>
                  <span className="text-xs text-text-muted">{fmt(v.createdAt)}</span>
                  {v.version === t.version ? (
                    <StatusPill tone="primary">Current</StatusPill>
                  ) : (
                    <>
                      <Link href={`/campaigns/templates/email/${t.id}?diff=${v.version}`} className="text-xs font-semibold text-primary hover:underline">
                        Compare
                      </Link>
                      {t.editable ? (
                        <ActionForm action={restoreTemplateVersionAction} confirm={`Put version ${v.version} back? It becomes a new version.`}>
                          <input type="hidden" name="templateId" value={t.id} />
                          <input type="hidden" name="version" value={v.version} />
                          <SubmitButton size="sm" variant="ghost">
                            Restore
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">This template was written before version history existed. Saving it here creates the first version.</p>
          )}
          {lines ? (
            <div className="mt-3" data-testid="template-diff">
              <h3 className="mb-1 text-xs font-semibold text-text-muted">
                Version {version} → current (− removed, + added)
              </h3>
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface-alt p-2 text-xs">
                {lines.map((l, i) => (
                  <div key={i} className={l.kind === "added" ? "bg-[#e6f4ea] text-[#14532d]" : l.kind === "removed" ? "bg-[#fde8e8] text-[#7f1d1d]" : ""}>
                    {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
                    {l.line}
                  </div>
                ))}
              </pre>
            </div>
          ) : version ? (
            <p className="mt-2 text-sm text-text-muted">Version {version} does not exist.</p>
          ) : null}
        </section>
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="template-usage">
          <h2 className="mb-2 text-[13px] font-semibold">Used by</h2>
          {t.usedBy.length ? (
            <ul className="space-y-1 text-sm">
              {t.usedBy.map((u, i) => (
                <li key={i}>
                  <span className="text-text-muted">{u.kind}:</span> {u.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No workflow rule or campaign uses this template. It can still be chosen in the e-mail composer.</p>
          )}
        </section>
      </div>
    </div>
  );
}
