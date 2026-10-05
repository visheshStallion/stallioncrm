import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { EMAIL_STARTERS, TEMPLATE_FIELDS, starter, templateBrands } from "@/server/modules/email/templates";
import { requireContext } from "@/server/request";
import { TEMPLATE_MODULES, TemplateEditor } from "../TemplateEditor";

export const metadata = { title: "New e-mail template" };

/** Starter gallery → rich editor. `?starter=<key>` opens a starter, `?starter=blank` an empty template. */
export default async function NewEmailTemplatePage({ searchParams }: { searchParams: Promise<{ starter?: string; module?: string; brand?: string }> }) {
  const { starter: key, module: moduleKey, brand } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "read")) forbidden();
  const { brands, group } = await templateBrands(ctx);
  if (!brands.length && !group) forbidden();
  const back = (
    <Link href="/campaigns/templates" className="text-sm text-primary hover:underline">
      ← Templates
    </Link>
  );

  if (!key) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageTitleRow title="New e-mail template" left={back} />
        <p className="mb-3 text-sm text-text-muted">Start from one of the ready-made e-mails for vehicle sales, or from an empty page. Every starter can be changed freely.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="starter-gallery">
          <li>
            <Link href="/campaigns/templates/email/new?starter=blank" className="block h-full rounded-lg border border-dashed border-border-strong bg-surface p-4 hover:border-primary">
              <span className="font-semibold">Empty template</span>
              <span className="mt-1 block text-xs text-text-muted">Just a text block in the brand layout.</span>
            </Link>
          </li>
          {EMAIL_STARTERS.map((s) => (
            <li key={s.key}>
              <Link href={`/campaigns/templates/email/new?starter=${s.key}`} className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-primary">
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <StatusPill tone={s.category === "Marketing" ? "warning" : "neutral"}>{s.category}</StatusPill>
                </span>
                <span className="mt-1 block text-xs text-text-muted">{s.subject}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const s = starter(key);
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow title={s ? `New template: ${s.name}` : "New e-mail template"} left={back} />
      <TemplateEditor
        templateId={null}
        brandId={null}
        defaultBrandId={brand === "group" && group ? "" : brands.some((b) => b.id === brand) ? brand! : undefined}
        brands={brands}
        group={group}
        initial={{ name: s?.name ?? "", module: moduleKey && TEMPLATE_MODULES.some((m) => m.key === moduleKey) ? moduleKey : (s?.module ?? null), folder: null, category: s?.category ?? "Sales", subject: s?.subject ?? "", doc: s?.doc ?? { blocks: [{ type: "text", html: "" }] }, active: true }}
        mergeFields={TEMPLATE_FIELDS}
        canEdit
        allowHtml={ctx.isAdmin}
      />
    </div>
  );
}
