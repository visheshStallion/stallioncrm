import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import type { AccessContext } from "@/server/access/types";
import { DOC_STARTERS } from "@/server/modules/doctpl/starters";
import { EMAIL_STARTERS } from "@/server/modules/email/starters";
import { RECORD_STARTERS } from "@/server/modules/rectpl/starters";
import { templateBrandOptions } from "@/server/modules/rectpl/service";
import { createFolderAction, deleteFolderAction } from "@/server/modules/templates/actions";
import { HUB_TABS, HUB_VIEWS, KIND_LABELS, hubList, modulesFor, type HubItem, type HubQuery } from "@/server/modules/templates/hub";
import { NewTemplate, RowMenu, StarButton, type NewTemplateData } from "./HubClient";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
/** module chip colours (our own palette): the same module always has the same colour */
const MODULE_TONE: Record<string, Tone> = { leads: "info", contacts: "primary", accounts: "primary", deals: "success", quotes: "warning", salesOrders: "warning", invoices: "danger", cases: "danger", activities: "info", products: "neutral", priceBooks: "neutral", campaigns: "info", inventoryDocuments: "neutral", vehicleUnits: "neutral" };
const STATUS_TONE: Record<HubItem["status"], Tone> = { Draft: "neutral", "Pending approval": "warning", Published: "success", Archived: "neutral", Inactive: "neutral" };

function ago(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  return `Updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(d)}`;
}

/**
 * The templates hub (prompt 22 §1): left panel with "+ New Template", the views and the folders; on the right the
 * tabs per template type, the filter toolbar and the list. Rendered under /templates (everyone) and /setup/templates.
 */
export async function HubView({ ctx, query, basePath }: { ctx: AccessContext; query: HubQuery; basePath: string }) {
  const [data, options] = await Promise.all([hubList(ctx, query), templateBrandOptions(ctx)]);
  const all = await hubList(ctx, { tab: data.tab }); // unfiltered rows of the tab: what can be cloned
  const link = (over: Partial<HubQuery>) => {
    const p = new URLSearchParams();
    const merged = { tab: data.tab, view: data.view, module: query.module, brand: query.brand, folder: query.folder, status: query.status, owner: query.owner, q: query.q, sort: query.sort, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "all") && !(k === "tab" && v === "email") && !(k === "sort" && v === "updated")) p.set(k, String(v));
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const back = link({});
  const newData: NewTemplateData = {
    tabs: HUB_TABS.map((t) => ({ key: t.key, label: t.label })),
    modules: Object.fromEntries(HUB_TABS.map((t) => [t.key, modulesFor(ctx, t.key)])),
    brands: options.brands.map((b) => ({ id: b.id, label: b.label })),
    group: options.group,
    starters: {
      email: EMAIL_STARTERS.map((s) => ({ key: s.key, name: s.name, module: s.module })),
      document: DOC_STARTERS.map((s) => ({ key: s.key, name: s.name, module: s.module })),
      record: RECORD_STARTERS.map((s) => ({ key: s.key, name: s.body.name, module: s.module })),
    },
    existing: all.rows.filter((r) => r.cloneable).map((r) => ({ kind: r.kind, id: r.id, name: r.name, module: r.module, tab: data.tab })),
  };
  const select = "crm-select";
  const folderList = data.folders.map((f) => ({ id: f.id, name: f.name, shared: f.shared, manageable: f.manageable }));

  return (
    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]" data-testid="templates-hub">
      <aside className="space-y-3" data-testid="hub-panel">
        <NewTemplate data={newData} tab={data.tab} />
        <nav aria-label="Template views" className="rounded-lg border border-border bg-surface py-1">
          <ul>
            {HUB_VIEWS.map((v) => (
              <li key={v.key}>
                <Link href={link({ view: v.key, folder: null })} aria-current={data.view === v.key && !query.folder ? "page" : undefined} className={`flex items-center justify-between px-3 py-1.5 text-[13px] hover:bg-muted ${data.view === v.key && !query.folder ? "bg-primary/10 font-semibold text-primary" : ""}`} data-view={v.key}>
                  <span>
                    {v.label}
                    {v.key === "public" ? " 👥" : ""}
                  </span>
                  <span className="text-xs text-text-muted">{data.viewCounts[v.key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="rounded-lg border border-border bg-surface p-2" aria-label="Folders" data-testid="hub-folders">
          <h2 className="px-1 text-[13px] font-semibold">Folders</h2>
          <ul className="mt-1">
            {data.folders.map((f) => (
              <li key={f.id} className="flex items-center gap-1">
                <Link href={link({ folder: f.id, view: "all" })} aria-current={query.folder === f.id ? "page" : undefined} className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-[13px] hover:bg-muted ${query.folder === f.id ? "bg-primary/10 font-semibold text-primary" : ""}`}>
                  ▸ {f.name}
                  <span className="ml-1 text-xs text-text-muted">
                    {f.count}
                    {f.shared ? ` · ${f.brandCode ?? "group"}` : ""}
                  </span>
                </Link>
                {f.manageable ? (
                  <ActionForm action={deleteFolderAction} confirm={`Remove the folder “${f.name}”? Its templates stay.`}>
                    <input type="hidden" name="folderId" value={f.id} />
                    <input type="hidden" name="back" value={link({ folder: null })} />
                    <button type="submit" className="px-1 text-xs text-text-muted hover:text-danger" aria-label={`Remove folder ${f.name}`}>
                      ×
                    </button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
            {data.folders.length === 0 ? <li className="px-2 py-1 text-xs text-text-muted">No folders yet.</li> : null}
          </ul>
          <ActionForm action={createFolderAction} className="mt-2 space-y-1 border-t border-border pt-2">
            <label htmlFor="hub-folder-name" className="block text-xs text-text-muted">
              New folder
            </label>
            <input id="hub-folder-name" name="name" required minLength={2} maxLength={60} className="crm-input w-full" placeholder="e.g. Sales follow-ups" />
            <select name="scope" aria-label="Who sees the folder" className="crm-select w-full" defaultValue="">
              <option value="">Only me</option>
              {options.brands.filter((b) => b.shared).map((b) => (
                <option key={b.id} value={b.id}>
                  Shared – {b.label}
                </option>
              ))}
              {options.group ? <option value="group">Shared – all brands</option> : null}
            </select>
            <SubmitButton size="sm" variant="outline">
              + New folder
            </SubmitButton>
          </ActionForm>
        </section>
      </aside>

      <div className="min-w-0">
        <div role="tablist" aria-label="Template types" className="mb-3 flex flex-wrap gap-1 border-b border-border" data-testid="hub-tabs">
          {HUB_TABS.map((t) => (
            <Link key={t.key} role="tab" aria-selected={data.tab === t.key} href={`${basePath}${t.key === "email" ? "" : `?tab=${t.key}`}`} className={`-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-[13px] ${data.tab === t.key ? "border-border bg-surface font-semibold text-primary" : "border-transparent text-text-muted hover:text-text"}`}>
              {t.label} <span className="text-xs text-text-muted">{data.tabCounts[t.key]}</span>
            </Link>
          ))}
        </div>

        <form className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3" data-testid="hub-toolbar">
          {data.tab !== "email" ? <input type="hidden" name="tab" value={data.tab} /> : null}
          {data.view !== "all" ? <input type="hidden" name="view" value={data.view} /> : null}
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Module</span>
            <select name="module" defaultValue={query.module ?? ""} className={select}>
              <option value="">All modules</option>
              {data.modules.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Brand</span>
            <select name="brand" defaultValue={query.brand ?? ""} className={select}>
              <option value="">All my brands</option>
              <option value="all">For every brand</option>
              {options.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Folder</span>
            <select name="folder" defaultValue={query.folder ?? ""} className={select}>
              <option value="">Any folder</option>
              {data.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Status</span>
            <select name="status" defaultValue={query.status ?? ""} className={select}>
              <option value="">Any status</option>
              {data.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Owner</span>
            <select name="owner" defaultValue={query.owner ?? ""} className={select}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
            </select>
          </label>
          <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Search templates</span>
            <input type="search" name="q" defaultValue={query.q ?? ""} placeholder="Name, subject, text" className="crm-input w-full" />
          </label>
          <label className="space-y-1 text-xs font-medium text-text-muted">
            <span className="block">Sort</span>
            <select name="sort" defaultValue={data.sort} className={select}>
              <option value="updated">Last updated</option>
              <option value="name">Name</option>
              <option value="used">Most used</option>
            </select>
          </label>
          <button type="submit" className="crm-btn crm-btn-secondary">
            Apply
          </button>
        </form>

        {data.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center" data-testid="hub-empty">
            <svg viewBox="0 0 64 64" className="mx-auto mb-3 h-14 w-14 text-text-muted" aria-hidden>
              <rect x="10" y="8" width="36" height="46" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <path d="M18 20h20M18 28h20M18 36h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="46" cy="46" r="11" fill="var(--color-surface, #fff)" stroke="currentColor" strokeWidth="2.5" />
              <path d="M46 41v10M41 46h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <p className="font-semibold">{all.rows.length === 0 ? "Create your first template" : "No template matches"}</p>
            <p className="mt-1 text-sm text-text-muted">{all.rows.length === 0 ? "Use “+ New Template”, select the module and start from a blank page or a starter." : "Change the view, the filters or the search text."}</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface" data-testid="hub-list">
            {data.rows.map((r) => (
              <li key={`${r.kind}:${r.id}`} className="flex items-start gap-2 border-b border-border px-3 py-2.5 last:border-0" data-testid="hub-row" data-kind={r.kind}>
                <StarButton kind={r.kind} id={r.id} on={r.favorite} name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.href ? (
                      <Link href={r.href} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    {r.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                    {data.tab === "document" ? <span className="text-xs text-text-muted">{KIND_LABELS[r.kind]}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <StatusPill tone={MODULE_TONE[r.module ?? ""] ?? "neutral"}>{r.moduleLabel}</StatusPill>
                    {r.brandCode ? <BrandBadge brand={{ code: r.brandCode }} /> : <span>All my brands</span>}
                    <span>· {r.scope}</span>
                    <StatusPill tone={STATUS_TONE[r.status]}>{r.status}</StatusPill>
                    {r.ownerName ? <span>· {r.mine ? "Me" : r.ownerName}</span> : null}
                  </div>
                  {r.associated.length ? (
                    <p className="mt-1 text-xs text-text-muted" data-testid="hub-associated">
                      Used by: {r.associated.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs text-text-muted">
                  <div>{ago(r.updatedAt)}</div>
                  <div>{r.usageCount ? `Used ${r.usageCount} time${r.usageCount === 1 ? "" : "s"}` : "Not used yet"}</div>
                </div>
                <RowMenu row={{ kind: r.kind, id: r.id, name: r.name, href: r.href, favorite: r.favorite, folderId: r.folderId, isDefault: r.isDefault, archived: r.status === "Archived" || r.status === "Inactive", editable: r.editable, cloneable: r.cloneable, canDefault: r.canDefault, canArchive: r.canArchive, associated: r.associated }} folders={folderList} back={back} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
