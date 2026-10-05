"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmailBlocksEditor, EmailPreview } from "@/components/crm/EmailBlocksEditor";
import { toast } from "@/components/Toaster";
import { Input } from "@/components/ui/input";
import { previewTemplateAction, saveRichTemplateAction } from "@/server/modules/email/actions";
import { EMAIL_CATEGORIES, type EmailDoc } from "@/server/modules/email/blocks";

export const TEMPLATE_MODULES = [
  { key: "", label: "Any record" },
  { key: "leads", label: "Leads" },
  { key: "deals", label: "Deals" },
  { key: "contacts", label: "Contacts" },
  { key: "accounts", label: "Accounts" },
  { key: "quotes", label: "Quotations" },
  { key: "salesOrders", label: "Sales Orders" },
  { key: "invoices", label: "Invoices" },
  { key: "cases", label: "Cases" },
];

interface Props {
  templateId: string | null;
  /** brand of an existing template (never changes); for a new one the choices below */
  brandId: string | null;
  /** new template: the owner preselected ("" = group) */
  defaultBrandId?: string;
  brands: Array<{ id: string; label: string }>;
  group: boolean;
  initial: { name: string; module: string | null; folder: string | null; category: string; subject: string; doc: EmailDoc; active: boolean };
  mergeFields: string[];
  canEdit: boolean;
  allowHtml: boolean;
}

/** Rich e-mail template editor: details, block document, lint (on preview and on save) and a brand-layout preview. */
export function TemplateEditor(p: Props) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(p.templateId ? (p.brandId ?? "") : (p.defaultBrandId ?? p.brands[0]?.id ?? ""));
  const [name, setName] = useState(p.initial.name);
  const [moduleKey, setModuleKey] = useState(p.initial.module ?? "");
  const [folder, setFolder] = useState(p.initial.folder ?? "");
  const [category, setCategory] = useState(p.initial.category);
  const [subject, setSubject] = useState(p.initial.subject);
  const [doc, setDoc] = useState(p.initial.doc);
  const [active, setActive] = useState(p.initial.active);
  const [preview, setPreview] = useState<string | null>(null);
  const [lint, setLint] = useState<{ errors: string[]; warnings: string[]; sizeKb: number } | null>(null);
  const [pending, start] = useTransition();

  const form = () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ brandId: brandId || null, name, module: moduleKey || null, folder: folder || null, category, subject, doc, active }));
    if (p.templateId) fd.set("templateId", p.templateId);
    return fd;
  };
  const onPreview = () =>
    start(async () => {
      const res = await previewTemplateAction(form());
      if (!res.ok) return toast(res.error.message, "error");
      setPreview(res.data.html);
      setLint(res.data.lint);
    });
  const onSave = () =>
    start(async () => {
      const res = await saveRichTemplateAction(form());
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "Template saved", "success");
      setLint((l) => ({ errors: [], warnings: res.data.warnings, sizeKb: l?.sizeKb ?? 0 }));
      if (res.data.redirect) router.push(res.data.redirect);
      else router.refresh();
    });

  const field = "block space-y-1 text-xs font-medium text-text-muted";
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]" data-testid="email-template-editor">
      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className={field}>
            <span>Name</span>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={!p.canEdit} />
          </label>
          <label className={field}>
            <span>Owner</span>
            <select className="crm-select w-full" value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={!!p.templateId || !p.canEdit}>
              {p.group || (p.templateId && !p.brandId) ? <option value="">Group (all brands)</option> : null}
              {p.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span>Category</span>
            <select className="crm-select w-full" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!p.canEdit}>
              {EMAIL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span>Offered on</span>
            <select className="crm-select w-full" value={moduleKey} onChange={(e) => setModuleKey(e.target.value)} disabled={!p.canEdit}>
              {TEMPLATE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span>Folder</span>
            <Input value={folder} maxLength={60} onChange={(e) => setFolder(e.target.value)} disabled={!p.canEdit} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!p.canEdit} /> Active (offered in the composer, workflows and campaigns)
          </label>
        </div>
        <label className={field}>
          <span>Subject</span>
          <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={!p.canEdit} />
        </label>
        {category === "Marketing" ? <p className="text-xs text-text-muted">Marketing e-mails get the customer&apos;s per-brand unsubscribe link in the footer and are not sent to customers who opted out of the brand.</p> : null}
        <EmailBlocksEditor doc={doc} onChange={setDoc} mergeFields={p.mergeFields} allowHtml={p.allowHtml} />
        {lint && (lint.errors.length || lint.warnings.length) ? (
          <ul className="space-y-1 rounded-md border border-border p-3 text-sm" data-testid="template-lint" aria-label="Checks">
            {lint.errors.map((e) => (
              <li key={e} className="text-danger">
                Error: {e}
              </li>
            ))}
            {lint.warnings.map((w) => (
              <li key={w} className="text-text-muted">
                Note: {w}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {p.canEdit ? (
            <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={onSave} data-testid="template-save">
              {pending ? "Working…" : "Save template"}
            </button>
          ) : (
            <span className="text-sm text-text-muted">You can read this template but not change it.</span>
          )}
          <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={onPreview}>
            Preview and check
          </button>
          {lint ? <span className="text-xs text-text-muted">{lint.sizeKb} KB of about 100 KB</span> : null}
        </div>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Preview with sample values</h2>
        <EmailPreview html={preview} />
      </section>
    </div>
  );
}
