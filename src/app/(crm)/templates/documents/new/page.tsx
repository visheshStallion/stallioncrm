import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDocTemplateAction } from "@/server/modules/doctpl/actions";
import { FINANCIAL_MODULES } from "@/server/modules/doctpl/content";
import { createOptions } from "@/server/modules/doctpl/service";
import { DOC_STARTERS, docStarter } from "@/server/modules/doctpl/starters";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { requireContext } from "@/server/request";

export const metadata = { title: "New document template" };

/** Step 1: choose a starter (or an empty page). Step 2 (`?starter=…` / `?module=…`): name, company and who uses it. */
export default async function NewDocumentTemplatePage({ searchParams }: { searchParams: Promise<{ starter?: string; module?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  const options = await createOptions(ctx);
  const starter = q.starter ? docStarter(q.starter) : undefined;
  const moduleKey = starter?.module ?? PRINT_MODULE_OPTIONS.find((m) => m.key === q.module)?.key;
  const back = (
    <Link href={moduleKey ? "/templates/documents/new" : "/templates/documents"} className="text-sm text-primary hover:underline">
      ← {moduleKey ? "Formats" : "Document templates"}
    </Link>
  );

  if (!moduleKey) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageTitleRow title="New document template" left={back} />
        <p className="mb-3 text-sm text-text-muted">Start from a ready-made format and change it, or from an empty page for any module. The company letterhead is added automatically.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="doc-starter-gallery">
          {DOC_STARTERS.map((s) => (
            <li key={s.key}>
              <Link href={`/templates/documents/new?starter=${s.key}`} className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-primary">
                <span className="font-semibold">{s.name}</span>
                <span className="mt-1 block text-xs text-text-muted">{s.description}</span>
                <span className="mt-2 block text-[11px] uppercase tracking-wide text-text-muted">
                  {PRINT_MODULE_OPTIONS.find((m) => m.key === s.module)?.plural} · {s.paper === "LETTER" ? "Letter" : s.paper}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border-strong bg-surface p-4" data-testid="doc-blank-form">
          <div className="space-y-1">
            <Label htmlFor="blank-module">Empty page for</Label>
            <select id="blank-module" name="module" className="crm-select" defaultValue="deals">
              {PRINT_MODULE_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.plural}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="crm-btn crm-btn-secondary">
            Continue
          </button>
        </form>
      </div>
    );
  }

  const financial = FINANCIAL_MODULES.includes(moduleKey);
  const moduleLabel = PRINT_MODULE_OPTIONS.find((m) => m.key === moduleKey)!.plural;
  const canShare = options.brands.some((b) => b.shared);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitleRow title={starter ? `New template: ${starter.name}` : `New ${moduleLabel} template`} left={back} />
      {financial && !canShare && !options.group ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm" role="alert" data-testid="doc-financial-note">
          {moduleLabel} are official documents: their templates are created by the brand&apos;s manager, its Brand Admin or an administrator, and used by everyone in the brand once published.
        </p>
      ) : (
        <ActionForm action={createDocTemplateAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <input type="hidden" name="module" value={moduleKey} />
          {starter ? <input type="hidden" name="starter" value={starter.key} /> : null}
          <div className="space-y-1">
            <Label htmlFor="doc-name">Name</Label>
            <Input id="doc-name" name="name" required minLength={2} maxLength={100} defaultValue={starter?.name ?? ""} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who uses the template</legend>
            {financial ? null : (
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="visibility" value="PERSONAL" defaultChecked className="mt-1" />
                <span>
                  <strong>Only me</strong> – a personal template; you publish it yourself.
                </span>
              </label>
            )}
            {canShare ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="visibility" value="SHARED_BRAND" defaultChecked={financial} className="mt-1" />
                <span>
                  <strong>Everyone in the brand</strong> – published by the brand&apos;s Brand Admin or an administrator; a brand manager submits it for approval.
                </span>
              </label>
            ) : null}
            {options.group ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="visibility" value="GROUP" defaultChecked={financial && !canShare} className="mt-1" />
                <span>
                  <strong>All brands (group)</strong> – one template for every brand; each document shows the letterhead of its own brand.
                </span>
              </label>
            ) : null}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="doc-brand">Company (brand)</Label>
            <select id="doc-brand" name="brandId" className="crm-select w-full" defaultValue={financial ? (options.brands.find((b) => b.shared)?.id ?? "") : ""}>
              {financial ? null : <option value="">All my brands – the letterhead of each record&apos;s brand</option>}
              {options.brands
                .filter((b) => !financial || b.shared)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
            </select>
            <p className="text-xs text-text-muted">A shared template belongs to one brand. A group template ignores this choice. The brand cannot be changed later.</p>
          </div>
          <SubmitButton>Create and open the editor</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
