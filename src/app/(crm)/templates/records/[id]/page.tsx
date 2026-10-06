import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { isAccessError } from "@/server/access/errors";
import { RT_STATUS_LABELS, RT_VISIBILITY_LABELS, editorLookups, getRecordTemplate, templateBrandOptions } from "@/server/modules/rectpl/service";
import { archiveTemplateAction, defaultTemplateAction, deleteTemplateAction, publishRecordTemplateAction, restoreRecordTemplateVersionAction, submitRecordTemplateAction } from "@/server/modules/templates/actions";
import { requireContext } from "@/server/request";
import { RecordTemplateEditor } from "../Editor";

export const metadata = { title: "Record template" };

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(d);

export default async function RecordTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string }> }) {
  const [{ id }, { r }] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  const t = await getRecordTemplate(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound(); // another brand's template, or someone's personal one, does not exist here
    throw e;
  });
  const [lookups, options] = await Promise.all([editorLookups(ctx, t.module, t.brandId), templateBrandOptions(ctx)]);
  const locked = t.status === "PENDING_APPROVAL" || t.status === "ARCHIVED";
  const ids = (
    <>
      <input type="hidden" name="kind" value="record" />
      <input type="hidden" name="id" value={t.id} />
    </>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow
        title={t.name}
        left={
          <>
            <Link href="/templates?tab=record" className="text-sm text-primary hover:underline">
              ← Templates
            </Link>
            <span data-testid="rt-status">
              <StatusPill tone={t.status === "PUBLISHED" ? "success" : t.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>
                {RT_STATUS_LABELS[t.status] ?? t.status} · version {t.version}
              </StatusPill>
            </span>
            {t.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
            <span className="text-sm text-text-muted">
              {t.moduleLabel} · {t.brandCode ?? "All my brands"} · {RT_VISIBILITY_LABELS[t.visibility]}
            </span>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3" data-testid="rt-actions">
        {t.status === "PUBLISHED" ? (
          <Link href={`${t.newHref}?template=${t.id}`} className="crm-btn crm-btn-primary" data-testid="rt-use">
            Create a {lookups.label.toLowerCase()} with it
          </Link>
        ) : null}
        {t.status === "DRAFT" && t.publishable ? (
          <ActionForm action={publishRecordTemplateAction}>
            <input type="hidden" name="id" value={t.id} />
            <SubmitButton size="sm">Publish</SubmitButton>
          </ActionForm>
        ) : null}
        {t.status === "DRAFT" && t.needsApproval ? (
          <ActionForm action={submitRecordTemplateAction}>
            <input type="hidden" name="id" value={t.id} />
            <SubmitButton size="sm">Submit for approval</SubmitButton>
          </ActionForm>
        ) : null}
        {t.status === "PENDING_APPROVAL" ? (
          <span className="text-sm">
            Waiting for the brand&apos;s Brand Admin –{" "}
            <Link href="/approvals" className="text-primary underline">
              Approvals
            </Link>
          </span>
        ) : null}
        {t.publishable && t.visibility !== "PERSONAL" && t.status === "PUBLISHED" ? (
          <ActionForm action={defaultTemplateAction}>
            {ids}
            <input type="hidden" name="on" value={t.isDefault ? "0" : "1"} />
            <SubmitButton size="sm" variant="outline">
              {t.isDefault ? "Remove as default" : "Set as default"}
            </SubmitButton>
          </ActionForm>
        ) : null}
        {t.publishable && t.status !== "PENDING_APPROVAL" ? (
          <ActionForm action={archiveTemplateAction}>
            {ids}
            <input type="hidden" name="archived" value={t.status === "ARCHIVED" ? "0" : "1"} />
            <SubmitButton size="sm" variant="ghost">
              {t.status === "ARCHIVED" ? "Restore" : "Archive"}
            </SubmitButton>
          </ActionForm>
        ) : null}
        {t.editable && t.usageCount === 0 && t.status !== "PENDING_APPROVAL" ? (
          <ActionForm action={deleteTemplateAction} confirm="Delete this template?">
            {ids}
            <input type="hidden" name="back" value="/templates?tab=record" />
            <SubmitButton size="sm" variant="ghost">
              Delete
            </SubmitButton>
          </ActionForm>
        ) : null}
        <span className="ml-auto text-xs text-text-muted" data-testid="rt-usage">
          {t.usageCount ? `${t.usageCount} record${t.usageCount === 1 ? "" : "s"} created from it · ${t.usedThisMonth} this month` : "No record was created from it yet"}
        </span>
      </div>

      <RecordTemplateEditor
        key={`${t.id}:${t.version}:${t.status}:${r ?? ""}`}
        templateId={t.id}
        module={t.module}
        moduleLabel={lookups.label}
        brands={options.brands}
        group={options.group}
        meta={{ brandId: t.brandId, visibility: t.visibility }}
        fields={lookups.fields}
        hasLines={lookups.hasLines}
        hasChildren={lookups.hasChildren}
        products={lookups.products}
        emailTemplates={lookups.emailTemplates}
        documentTemplates={lookups.documentTemplates}
        initial={{ name: t.name, description: t.description ?? "", fieldValues: t.fieldValues, lockedFields: t.lockedFields, hiddenFields: t.hiddenFields, lineItems: t.lineItems, childRecords: t.childRecords, emailTemplateId: t.emailTemplateId, documentTemplateId: t.documentTemplateId }}
        canEdit={t.editable && !locked}
      />

      <section className="mt-4 rounded-lg border border-border bg-surface p-4" data-testid="rt-versions">
        <h2 className="mb-2 text-[13px] font-semibold">Versions</h2>
        <ul className="space-y-1 text-sm">
          {t.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Version {v.version}</span>
              <span className="text-xs text-text-muted">
                {fmt(v.changedAt)}
                {v.changedBy ? ` · ${v.changedBy}` : ""}
              </span>
              {v.version === t.version ? (
                <StatusPill tone="primary">Current</StatusPill>
              ) : t.editable && !locked ? (
                <ActionForm action={restoreRecordTemplateVersionAction} confirm={`Put version ${v.version} back? It becomes a new version.`}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="version" value={v.version} />
                  <SubmitButton size="sm" variant="ghost">
                    Restore
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-muted">A record remembers the template and the version it was created from.</p>
      </section>
    </div>
  );
}
