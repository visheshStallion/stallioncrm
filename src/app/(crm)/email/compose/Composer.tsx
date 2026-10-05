"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { EmailBlocksEditor, EmailPreview } from "@/components/crm/EmailBlocksEditor";
import { toast } from "@/components/Toaster";
import { Input } from "@/components/ui/input";
import type { EmailDoc } from "@/server/modules/email/blocks";
import { previewEmailAction, saveDraftAction, sendEmailAction, testEmailAction } from "@/server/modules/email/actions";

export interface ComposerDraft {
  id: string;
  payload: Record<string, unknown>;
}

interface Props {
  record: { parentType: string; parentId: string; brandId: string; name: string; label: string; path: string };
  from: string | null;
  brandLabel: string;
  brands: Array<{ id: string; label: string }>;
  suggestions: Array<{ name: string; email: string }>;
  templates: Array<{ id: string; name: string; subject: string; category: string | null; group: boolean; doc: EmailDoc }>;
  hasSignature: boolean;
  attachments: Array<{ id: string; fileName: string; size: number }>;
  printTemplates: Array<{ id: string; name: string }>;
  mergeFields: string[];
  allowHtml: boolean;
  draft: ComposerDraft | null;
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : "");
const split = (v: string) => v.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean);
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const EMPTY: EmailDoc = { blocks: [{ type: "text", html: "" }] };

/** The e-mail composer: recipients, template, block editor, attachments, preview, test, schedule, draft, send. */
export function Composer(p: Props) {
  const router = useRouter();
  const d = p.draft?.payload;
  const [to, setTo] = useState(d ? list(d.to) : (p.suggestions[0]?.email ?? ""));
  const [cc, setCc] = useState(d ? list(d.cc) : "");
  const [bcc, setBcc] = useState(d ? list(d.bcc) : "");
  const [copies, setCopies] = useState(!!d && (list(d.cc) !== "" || list(d.bcc) !== ""));
  const [subject, setSubject] = useState(d ? String(d.subject ?? "") : "");
  const [doc, setDoc] = useState<EmailDoc>(d?.doc ? (d.doc as EmailDoc) : EMPTY);
  const [templateId, setTemplateId] = useState(d?.templateId ? String(d.templateId) : "");
  const [signature, setSignature] = useState(d ? d.includeSignature !== false : true);
  const [attachPrint, setAttachPrint] = useState(d?.attachPrint ? String(d.attachPrint) : "");
  const [attachmentIds, setAttachmentIds] = useState<string[]>(d && Array.isArray(d.attachmentIds) ? d.attachmentIds.map(String) : []);
  const [followUp, setFollowUp] = useState(d && typeof d.followUpDays === "number" ? String(d.followUpDays) : "");
  const [files, setFiles] = useState<File[]>([]);
  const [sendAt, setSendAt] = useState("");
  const [draftId, setDraftId] = useState(p.draft?.id ?? "");
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const form = (withFiles = false) => {
    const fd = new FormData();
    fd.set(
      "payload",
      JSON.stringify({
        parentType: p.record.parentType,
        parentId: p.record.parentId,
        brandId: p.brands.length ? p.record.brandId : null,
        to: split(to),
        cc: split(cc),
        bcc: split(bcc),
        subject,
        doc,
        templateId: templateId || null,
        includeSignature: signature,
        attachPrint: attachPrint || null,
        attachmentIds,
        followUpDays: followUp === "" ? null : Number(followUp),
      }),
    );
    if (draftId) fd.set("draftId", draftId);
    if (withFiles) for (const f of files) fd.append("files", f);
    return fd;
  };

  const chooseTemplate = (id: string) => {
    const t = p.templates.find((x) => x.id === id);
    if (t && (subject || doc.blocks.some((b) => b.type !== "text" || b.html.replace(/<[^>]+>/g, "").trim())) && !window.confirm("Replace the subject and text with the template?")) return;
    setTemplateId(id);
    if (t) {
      setSubject(t.subject);
      setDoc(t.doc);
    }
  };

  const run = (fn: () => Promise<void>) => start(async () => fn().catch(() => toast("Something went wrong – try again", "error")));
  const onPreview = () =>
    run(async () => {
      const res = await previewEmailAction(form());
      if (res.ok) setPreview(res.data);
      else toast(res.error.message, "error");
    });
  const onTest = () =>
    run(async () => {
      const res = await testEmailAction(form());
      toast(res.ok ? (res.data.message ?? "Test sent") : res.error.message, res.ok ? "success" : "error");
    });
  const onDraft = (schedule: boolean) =>
    run(async () => {
      if (schedule && !sendAt) return toast("Choose the date and time to send", "error");
      if (schedule && files.length) return toast("A scheduled e-mail cannot carry uploaded files – attach the record's documents or the printout instead", "error");
      const fd = form();
      if (schedule) fd.set("sendAt", new Date(sendAt).toISOString());
      const res = await saveDraftAction(fd);
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "Saved", "success");
      if (schedule) router.push(p.record.path);
      else {
        setDraftId(res.data.id);
        router.refresh();
      }
    });
  const onSend = () =>
    run(async () => {
      const res = await sendEmailAction(form(true));
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.message ?? "E-mail sent", "success");
      router.push(res.data.redirect ?? p.record.path);
    });

  const categories = [...new Set(p.templates.map((t) => t.category ?? "Other"))];
  const row = "grid grid-cols-[88px_1fr] items-center gap-2";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]" data-testid="email-composer">
      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className={row}>
          <span className="text-xs font-medium text-text-muted">From</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {p.brands.length > 1 ? (
              <select
                className="crm-select"
                aria-label="Send as brand"
                value={p.record.brandId}
                onChange={(e) => {
                  if (window.confirm("Switch the sending brand? The text you wrote is discarded.")) router.push(`/email/compose?type=${p.record.parentType}&id=${p.record.parentId}&brand=${e.target.value}`);
                }}
              >
                {p.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            ) : null}
            <span data-testid="email-from">{p.from ?? "No sender configured"}</span>
            <span className="text-xs text-text-muted">The sender is the brand&apos;s address; replies come to you.</span>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="em-to" className="text-xs font-medium text-text-muted">
            To
          </label>
          <div className="flex items-center gap-2">
            <Input id="em-to" value={to} onChange={(e) => setTo(e.target.value)} list="em-suggestions" placeholder="name@example.com, …" autoComplete="off" />
            <datalist id="em-suggestions">
              {p.suggestions.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name}
                </option>
              ))}
            </datalist>
            {copies ? null : (
              <button type="button" className="whitespace-nowrap text-xs font-semibold text-primary" onClick={() => setCopies(true)}>
                Cc / Bcc
              </button>
            )}
          </div>
        </div>
        {copies ? (
          <>
            <div className={row}>
              <label htmlFor="em-cc" className="text-xs font-medium text-text-muted">
                Cc
              </label>
              <Input id="em-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
            </div>
            <div className={row}>
              <label htmlFor="em-bcc" className="text-xs font-medium text-text-muted">
                Bcc
              </label>
              <Input id="em-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" />
            </div>
          </>
        ) : null}
        <div className={row}>
          <label htmlFor="em-template" className="text-xs font-medium text-text-muted">
            Template
          </label>
          <select id="em-template" className="crm-select" value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
            <option value="">No template</option>
            {categories.map((c) => (
              <optgroup key={c} label={c}>
                {p.templates
                  .filter((t) => (t.category ?? "Other") === c)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.group ? " (group)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className={row}>
          <label htmlFor="em-subject" className="text-xs font-medium text-text-muted">
            Subject
          </label>
          <Input id="em-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <EmailBlocksEditor doc={doc} onChange={setDoc} mergeFields={p.mergeFields} allowHtml={p.allowHtml} />

        <fieldset className="space-y-2 rounded-md border border-border p-3 text-sm">
          <legend className="px-1 text-xs font-semibold text-text-muted">Attachments</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="em-print" className="text-xs text-text-muted">
              {p.record.label} as PDF
            </label>
            <select id="em-print" className="crm-select" value={attachPrint} onChange={(e) => setAttachPrint(e.target.value)}>
              <option value="">Do not attach</option>
              <option value="default">Standard printout on the brand letterhead</option>
              {p.printTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {p.attachments.length ? (
            <ul className="space-y-1" aria-label="Documents of the record">
              {p.attachments.map((a) => (
                <li key={a.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={attachmentIds.includes(a.id)} onChange={(e) => setAttachmentIds(e.target.checked ? [...attachmentIds, a.id] : attachmentIds.filter((x) => x !== a.id))} />
                    {a.fileName} <span className="text-xs text-text-muted">{kb(a.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="crm-btn crm-btn-secondary" onClick={() => fileRef.current?.click()}>
              Upload files
            </button>
            <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Upload files" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {f.name} · {kb(f.size)}
                <button type="button" aria-label={`Remove ${f.name}`} className="font-bold" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
            <span className="text-xs text-text-muted">10 MB in total</span>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} /> Add my signature
            {p.hasSignature ? null : (
              <Link href="/setup/personal" target="_blank" className="text-xs text-primary underline">
                (none yet – create one)
              </Link>
            )}
          </label>
          <label className="flex items-center gap-2">
            Follow-up task
            <select className="crm-select" value={followUp} onChange={(e) => setFollowUp(e.target.value)}>
              <option value="">None</option>
              <option value="1">Tomorrow</option>
              <option value="3">In 3 days</option>
              <option value="7">In a week</option>
              <option value="14">In two weeks</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button type="button" className="crm-btn crm-btn-primary" disabled={pending || !p.from} onClick={onSend} data-testid="email-send">
            {pending ? "Working…" : "Send"}
          </button>
          <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={onPreview}>
            Preview
          </button>
          <button type="button" className="crm-btn crm-btn-secondary" disabled={pending || !p.from} onClick={onTest}>
            Send test to me
          </button>
          <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={() => onDraft(false)}>
            Save draft
          </button>
          <span className="ml-auto flex items-center gap-2">
            <label htmlFor="em-at" className="text-xs text-text-muted">
              Send later
            </label>
            <input id="em-at" type="datetime-local" className="crm-input" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
            <button type="button" className="crm-btn crm-btn-secondary" disabled={pending || !p.from} onClick={() => onDraft(true)}>
              Schedule
            </button>
          </span>
        </div>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Preview – {p.brandLabel}</h2>
        <EmailPreview html={preview?.html ?? null} subject={preview?.subject} />
      </section>
    </div>
  );
}
