import Link from "next/link";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { STATUSES, STATUS_LABELS, VISIBILITY_LABELS, type TemplateStatus } from "@/server/modules/doctpl/content";
import { createOptions, listTemplates } from "@/server/modules/doctpl/service";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { requireContext } from "@/server/request";

export const metadata = { title: "Document templates" };

const TONE: Record<TemplateStatus, "neutral" | "warning" | "success"> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", PUBLISHED: "success", ARCHIVED: "neutral" };
const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(d) : "—");

/**
 * Document templates the user may see: their own, the published ones of their brands and of the group, and the ones
 * they may edit. Filters: module, brand, status, owner. Templates of other brands are not listed.
 */
export default async function DocumentTemplatesPage({ searchParams }: { searchParams: Promise<{ module?: string; brand?: string; status?: string; owner?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  const [templates, options] = await Promise.all([listTemplates(ctx, { module: q.module || null, brandId: q.brand || null, status: q.status || null, owner: q.owner === "me" ? "me" : null }), createOptions(ctx)]);
  const select = "crm-select";

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="Document templates"
        actions={
          <>
            <Link href="/templates?tab=document" className="crm-btn crm-btn-secondary">
              Templates hub
            </Link>
            <Link href="/templates/documents/new" className="crm-btn crm-btn-primary" data-testid="new-doc-template">
              New document template
            </Link>
          </>
        }
      />
      <p className="mb-3 text-sm text-text-muted">Company-formatted documents – invoices, sales orders, quotations, offer letters, receipts – designed on a page with the brand letterhead and chosen when a record is sent, printed or downloaded.</p>
      <form className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3" data-testid="doc-template-filters">
        <label className="space-y-1 text-xs font-medium text-text-muted">
          <span className="block">Module</span>
          <select name="module" defaultValue={q.module ?? ""} className={select}>
            <option value="">All modules</option>
            {PRINT_MODULE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.plural}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-text-muted">
          <span className="block">Brand</span>
          <select name="brand" defaultValue={q.brand ?? ""} className={select}>
            <option value="">All my brands</option>
            <option value="all">Templates for every brand</option>
            {options.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-text-muted">
          <span className="block">Status</span>
          <select name="status" defaultValue={q.status ?? ""} className={select}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-text-muted">
          <span className="block">Owner</span>
          <select name="owner" defaultValue={q.owner ?? ""} className={select}>
            <option value="">Anyone</option>
            <option value="me">Created by me</option>
          </select>
        </label>
        <button type="submit" className="crm-btn crm-btn-secondary">
          Apply
        </button>
      </form>
      <section className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" data-testid="doc-templates-table">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
              <th className="px-3 py-2">Template</th>
              <th className="px-3 py-2">Module</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/templates/documents/${t.id}`} className="font-medium text-primary hover:underline">
                    {t.name}
                  </Link>
                  {t.isDefault ? (
                    <StatusPill tone="primary" className="ml-2">
                      Default
                    </StatusPill>
                  ) : null}
                </td>
                <td className="px-3 py-2">{t.moduleLabel}</td>
                <td className="px-3 py-2">
                  {t.brandCode ?? "All my brands"} <span className="text-xs text-text-muted">· {VISIBILITY_LABELS[t.visibility]}</span>
                </td>
                <td className="px-3 py-2">
                  <StatusPill tone={TONE[t.status]}>{STATUS_LABELS[t.status]}{t.status === "PUBLISHED" ? ` v${t.version}` : ""}</StatusPill>
                  {t.dirty && t.status === "PUBLISHED" ? <span className="ml-2 text-xs text-text-muted">unpublished changes</span> : null}
                </td>
                <td className="px-3 py-2">{t.mine ? "Me" : t.ownerName}</td>
                <td className="px-3 py-2">{t.usageCount ? `${t.usageCount}×` : "—"}</td>
                <td className="px-3 py-2">{fmt(t.updatedAt)}</td>
              </tr>
            ))}
            {templates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-text-muted">
                  No document templates here yet. Start from a ready-made format with “New document template”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
