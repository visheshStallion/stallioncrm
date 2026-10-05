import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { archiveDocTemplateAction, defaultDocTemplateAction, deleteDocTemplateAction, publishDocTemplateAction, restoreDocVersionAction, submitDocTemplateAction } from "@/server/modules/doctpl/actions";
import { FINANCIAL_MODULES, STATUS_LABELS, VISIBILITY_LABELS } from "@/server/modules/doctpl/content";
import { builderCatalogue, getTemplate } from "@/server/modules/doctpl/service";
import { requireContext } from "@/server/request";
import { Builder } from "../Builder";

export const metadata = { title: "Document template" };

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(d) : "");

export default async function DocumentTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getTemplate(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound(); // another brand's template, or someone's personal one, does not exist here
    throw e;
  });
  const [cat, brand] = await Promise.all([builderCatalogue(ctx, t.module), t.brandId ? scopedDb(ctx).brand.findUnique({ where: { id: t.brandId }, select: { code: true, name: true, color: true } }) : null]);
  const locked = t.status === "PENDING_APPROVAL" ? "Waiting for approval – it cannot be changed until the request is decided." : t.status === "ARCHIVED" ? "Archived – restore it to change it." : null;
  const hidden = <input type="hidden" name="templateId" value={t.id} />;
  const canPublishNow = t.publishable && !locked && (!t.hasPublished || t.dirty);
  const canSubmit = t.needsApproval && !locked && (!t.hasPublished || t.dirty);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitleRow
        title={t.name}
        left={
          <>
            <Link href="/templates/documents" className="text-sm text-primary hover:underline">
              ← Document templates
            </Link>
            <span data-testid="doc-status">
              <StatusPill tone={t.status === "PUBLISHED" ? "success" : t.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>
                {STATUS_LABELS[t.status]}
                {t.version ? ` · version ${t.version}` : ""}
              </StatusPill>
            </span>
            {t.dirty && t.hasPublished ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
            {t.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
            <span className="text-sm text-text-muted">
              {t.moduleLabel} · {brand ? `${brand.code} – ${brand.name}` : "All my brands"} · {VISIBILITY_LABELS[t.visibility]}
            </span>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3" data-testid="doc-actions">
        {canPublishNow ? (
          <ActionForm action={publishDocTemplateAction} className="flex items-center gap-2">
            {hidden}
            <input name="note" aria-label="Version note" placeholder="What changed (optional)" maxLength={200} className="crm-input w-56" />
            <SubmitButton size="sm">Publish{t.hasPublished ? ` version ${t.version + 1}` : ""}</SubmitButton>
          </ActionForm>
        ) : null}
        {canSubmit ? (
          <ActionForm action={submitDocTemplateAction}>
            {hidden}
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
        {t.publishable && t.visibility !== "PERSONAL" && t.hasPublished && t.status !== "ARCHIVED" ? (
          <ActionForm action={defaultDocTemplateAction}>
            {hidden}
            <input type="hidden" name="on" value={t.isDefault ? "0" : "1"} />
            <SubmitButton size="sm" variant="outline">
              {t.isDefault ? "Remove as default" : `Make default for ${t.moduleLabel.toLowerCase()}s`}
            </SubmitButton>
          </ActionForm>
        ) : null}
        {t.publishable && t.status !== "PENDING_APPROVAL" ? (
          <ActionForm action={archiveDocTemplateAction} confirm={t.status === "ARCHIVED" ? undefined : "Archive this template? It is no longer offered when sending or printing."}>
            {hidden}
            <input type="hidden" name="archived" value={t.status === "ARCHIVED" ? "0" : "1"} />
            <SubmitButton size="sm" variant="ghost">
              {t.status === "ARCHIVED" ? "Restore" : "Archive"}
            </SubmitButton>
          </ActionForm>
        ) : null}
        {t.editable && t.usageCount === 0 && t.status !== "PENDING_APPROVAL" ? (
          <ActionForm action={deleteDocTemplateAction} confirm="Delete this template?">
            {hidden}
            <SubmitButton size="sm" variant="ghost">
              Delete
            </SubmitButton>
          </ActionForm>
        ) : null}
        <span className="ml-auto text-xs text-text-muted">
          {t.hasPublished ? `Documents are generated with version ${t.version}${t.approvedBy ? `, published by ${t.approvedBy}` : ""}${t.publishedAt ? ` on ${fmt(t.publishedAt)}` : ""}.` : "Not published yet – it cannot be used for documents."}
          {t.usageCount ? ` Used ${t.usageCount}×.` : ""}
          {t.visibility === "PERSONAL" && FINANCIAL_MODULES.includes(t.module) ? " Personal templates cannot be used for official documents." : ""}
        </span>
      </div>

      <Builder
        key={`${t.id}:${t.updatedAt.getTime()}`}
        templateId={t.id}
        module={t.module}
        moduleLabel={t.moduleLabel}
        brandId={t.brandId}
        brandLabel={brand ? `${brand.code} – ${brand.name}` : "All my brands"}
        brandColor={brand?.color ?? null}
        initial={{ name: t.name, paper: t.paper, orientation: t.orientation, margins: t.margins, cssOverrides: t.cssOverrides, content: t.content }}
        catalogue={cat}
        canEdit={t.editable}
        locked={locked}
        allowHtml={ctx.isAdmin}
      />

      <section className="mt-4 rounded-lg border border-border bg-surface p-4" data-testid="doc-versions">
        <h2 className="mb-2 text-[13px] font-semibold">Versions</h2>
        {t.versions.length ? (
          <ul className="space-y-1 text-sm">
            {t.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Version {v.version}</span>
                <span className="text-xs text-text-muted">
                  {fmt(v.changedAt)}
                  {v.changedBy ? ` · ${v.changedBy}` : ""}
                  {v.note ? ` · ${v.note}` : ""}
                </span>
                {v.version === t.version ? <StatusPill tone="primary">In use</StatusPill> : null}
                {t.editable && !locked ? (
                  <ActionForm action={restoreDocVersionAction} confirm={`Put version ${v.version} into the editor? Your unpublished changes are replaced.`}>
                    {hidden}
                    <input type="hidden" name="version" value={v.version} />
                    <SubmitButton size="sm" variant="ghost">
                      Open in editor
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No version has been published. Documents that were generated keep the version they were made with.</p>
        )}
      </section>
    </div>
  );
}
