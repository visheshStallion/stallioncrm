import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { RT_MODULES, rtModule } from "@/server/modules/rectpl/modules";
import { createQuoteFromTemplateAction } from "@/server/modules/rectpl/actions";
import { pickerTemplates } from "@/server/modules/rectpl/service";
import { hubList } from "@/server/modules/templates/hub";
import { requireContext } from "@/server/request";

export const metadata = { title: "Create from template" };

/**
 * "Create from template": the published record templates the user may use – favourites first, then by folder.
 * /templates/pick?module=leads (one module) or /templates/pick (quick create: every module the user can create in).
 * Quotations: /templates/pick?module=quotes&dealId=… (a quotation is created for a deal).
 */
export default async function PickTemplatePage({ searchParams }: { searchParams: Promise<{ module?: string; q?: string; dealId?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  if (q.module && !rtModule(q.module)) notFound();
  const modules = RT_MODULES.filter((m) => (!q.module || m.key === q.module) && hasPermission(ctx, m.permission, "create"));
  if (q.module && !modules.length) notFound();
  const hub = await hubList(ctx, { tab: "record" });
  const meta = new Map(hub.rows.map((r) => [r.id, r]));
  const folderName = new Map(hub.folders.map((f) => [f.id, f.name]));
  const text = (q.q ?? "").trim().toLowerCase();
  const groups = await Promise.all(
    modules.map(async (m) => {
      const rows = (await pickerTemplates(ctx, m.key))
        .filter((t) => !text || `${t.name} ${t.description ?? ""}`.toLowerCase().includes(text))
        .map((t) => ({ ...t, favorite: meta.get(t.id)?.favorite ?? false, folder: folderName.get(meta.get(t.id)?.folderId ?? "") ?? null }))
        // favourites first, then the brand default, then by folder and name
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.isDefault) - Number(a.isDefault) || (a.folder ?? "~").localeCompare(b.folder ?? "~") || a.name.localeCompare(b.name));
      return { module: m, rows };
    }),
  );
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const one = q.module ? modules[0]! : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitleRow
        title={one ? `Create ${one.label} from template` : "Create from template"}
        left={
          one ? (
            <Link href={q.dealId ? `/deals/${q.dealId}` : `/${one.key}`} className="text-sm text-primary hover:underline">
              ← Back
            </Link>
          ) : undefined
        }
      />
      <form className="mb-3 flex gap-2">
        {q.module ? <input type="hidden" name="module" value={q.module} /> : null}
        {q.dealId ? <input type="hidden" name="dealId" value={q.dealId} /> : null}
        <input type="search" name="q" defaultValue={q.q ?? ""} placeholder="Search templates" aria-label="Search templates" className="crm-input flex-1" />
        <button type="submit" className="crm-btn crm-btn-secondary">
          Search
        </button>
      </form>
      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-text-muted" data-testid="pick-empty">
          No published template{one ? ` for ${one.plural.toLowerCase()}` : ""} yet.{" "}
          <Link href="/templates?tab=record" className="text-primary underline">
            Open the templates hub
          </Link>{" "}
          to create one.
        </p>
      ) : null}
      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.module.key} className="mb-4" data-testid="pick-group">
            {one ? null : <h2 className="mb-1 text-[13px] font-semibold">{g.module.plural}</h2>}
            <ul className="overflow-hidden rounded-lg border border-border bg-surface">
              {g.rows.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0" data-testid="pick-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {t.favorite ? "★ " : ""}
                        {t.name}
                      </span>
                      {t.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                      <span className="text-xs text-text-muted">
                        {t.brandCode ?? "All my brands"}
                        {t.personal ? " · personal" : ""}
                        {t.folder ? ` · ${t.folder}` : ""}
                      </span>
                    </div>
                    {t.description ? <p className="text-xs text-text-muted">{t.description}</p> : null}
                  </div>
                  {g.module.key === "quotes" && q.dealId ? (
                    <ActionForm action={createQuoteFromTemplateAction}>
                      <input type="hidden" name="templateId" value={t.id} />
                      <input type="hidden" name="dealId" value={q.dealId} />
                      <SubmitButton size="sm">Create quotation</SubmitButton>
                    </ActionForm>
                  ) : (
                    <Link href={`${g.module.newHref}?template=${t.id}`} className="crm-btn crm-btn-primary" data-testid="pick-use">
                      Use
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
