"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { RichTextEditor } from "@/components/crm/RichTextEditor";
import { toast } from "@/components/Toaster";
import { Input } from "@/components/ui/input";
import { previewDocTemplateAction, saveDocTemplateAction } from "@/server/modules/doctpl/actions";
import { CONDITION_LABELS, CONDITION_OPS, CSS_FONTS, DOC_BLOCK_HINTS, DOC_BLOCK_LABELS, type ConditionOp, type DocBlock, type DocContent } from "@/server/modules/doctpl/content";

export interface BuilderCatalogue {
  sampleId: string | null;
  samples: Array<{ id: string; title: string }>;
  fields: Array<{ key: string; label: string }>;
  lists: Array<{ key: string; label: string; columns: string[] }>;
  lineColumns: Array<{ key: string; label: string }>;
  mergeFields: string[];
}

interface Props {
  templateId: string;
  module: string;
  moduleLabel: string;
  brandId: string | null;
  brandLabel: string;
  brandColor: string | null;
  initial: { name: string; paper: string; orientation: string; margins: { top: number; right: number; bottom: number; left: number }; cssOverrides: string; content: DocContent };
  catalogue: BuilderCatalogue;
  canEdit: boolean;
  /** why the template cannot be changed right now (waiting for approval, archived) */
  locked: string | null;
  allowHtml: boolean;
}

const PAGE_MM: Record<string, [number, number]> = { A4: [210, 297], LETTER: [215.9, 279.4], A5: [148, 210] };
const PX = 3.7795; // CSS pixels per millimetre

const NEW: { [K in DocBlock["type"]]: (c: BuilderCatalogue) => Extract<DocBlock, { type: K }> } = {
  rich: () => ({ type: "rich", html: "<p></p>" }),
  title: () => ({ type: "title", text: "DOCUMENT", showNumber: true, showDates: true }),
  parties: () => ({ type: "parties", shipTo: false }),
  fields: (c) => ({ type: "fields", columns: 2, fields: c.fields.slice(0, 6).map((f) => f.key) }),
  lineItems: (c) => ({ type: "lineItems", columns: c.lineColumns.map((x) => x.key), zebra: true }),
  totals: () => ({ type: "totals", words: true }),
  payment: () => ({ type: "payment", terms: "" }),
  vehicle: () => ({ type: "vehicle" }),
  terms: () => ({ type: "terms" }),
  signatures: () => ({ type: "signatures", roles: ["Customer", "Sales Executive"], stamp: true }),
  qr: () => ({ type: "qr", value: "url" }),
  barcode: () => ({ type: "barcode", value: "number" }),
  conditional: (c) => ({ type: "conditional", field: c.fields[0]?.key ?? "status", op: "notEmpty", value: "", html: "<p>Shown only when the condition is true.</p>" }),
  repeat: (c) => ({ type: "repeat", list: c.lists[0]?.key ?? "", html: `<p>{{row.index}}. ${c.lists[0]?.columns[0] ? `{{row.${c.lists[0].columns[0]}}}` : ""}</p>` }),
  related: (c) => ({ type: "related", list: c.lists[0]?.key ?? "" }),
  pageBreak: () => ({ type: "pageBreak" }),
};

const label = "block space-y-1 text-xs font-medium text-text-muted";
const check = "flex items-center gap-2 text-sm";

function BlockEditor({ block, set, cat, color, allowHtml }: { block: DocBlock; set: (b: DocBlock) => void; cat: BuilderCatalogue; color: string[]; allowHtml: boolean }) {
  const rte = (value: string, onChange: (html: string) => void, name: string, fields = cat.mergeFields) => <RichTextEditor label={name} value={value} onChange={onChange} mergeFields={fields} allowHtml={allowHtml} maxImageBytes={300 * 1024} minHeight={90} extraColors={color} />;
  switch (block.type) {
    case "rich":
      return rte(block.html, (html) => set({ ...block, html }), "Text");
    case "title":
      return (
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            <span>Title</span>
            <Input value={block.text} maxLength={200} className="w-72" onChange={(e) => set({ ...block, text: e.target.value })} />
          </label>
          <label className={check}>
            <input type="checkbox" checked={block.showNumber} onChange={(e) => set({ ...block, showNumber: e.target.checked })} /> Document number
          </label>
          <label className={check}>
            <input type="checkbox" checked={block.showDates} onChange={(e) => set({ ...block, showDates: e.target.checked })} /> Date and due date
          </label>
        </div>
      );
    case "parties":
      return (
        <label className={check}>
          <input type="checkbox" checked={block.shipTo} onChange={(e) => set({ ...block, shipTo: e.target.checked })} /> Also show “Ship to”
        </label>
      );
    case "fields":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className={label}>
              <span>Heading (optional)</span>
              <Input value={block.title ?? ""} maxLength={80} className="w-56" onChange={(e) => set({ ...block, title: e.target.value || undefined })} />
            </label>
            <label className={label}>
              <span>Columns</span>
              <select className="crm-select" value={block.columns} onChange={(e) => set({ ...block, columns: Number(e.target.value) as 1 | 2 | 3 })}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          </div>
          <fieldset className="max-h-40 overflow-auto rounded border border-border p-2">
            <legend className="px-1 text-xs text-text-muted">Fields ({block.fields.length} chosen)</legend>
            <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              {cat.fields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={block.fields.includes(f.key)} onChange={(e) => set({ ...block, fields: e.target.checked ? [...block.fields, f.key] : block.fields.filter((k) => k !== f.key) })} /> {f.label}
                </label>
              ))}
            </div>
            {cat.fields.length === 0 ? <p className="text-xs text-text-muted">No record of this module to read the fields from yet.</p> : null}
          </fieldset>
        </div>
      );
    case "lineItems": {
      const names = new Map(cat.lineColumns.map((c) => [c.key, c.label]));
      const rest = cat.lineColumns.filter((c) => !block.columns.includes(c.key));
      const move = (i: number, by: number) => {
        const cols = [...block.columns];
        const j = i + by;
        if (j < 0 || j >= cols.length) return;
        [cols[i], cols[j]] = [cols[j]!, cols[i]!];
        set({ ...block, columns: cols });
      };
      return (
        <div className="space-y-2">
          <ol className="flex flex-wrap gap-1" aria-label="Columns in print order">
            {block.columns.map((k, i) => (
              <li key={k} className="inline-flex items-center gap-1 rounded border border-border bg-surface-alt px-1.5 py-0.5 text-xs">
                <button type="button" aria-label={`Move ${names.get(k) ?? k} left`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </button>
                {names.get(k) ?? k}
                <button type="button" aria-label={`Move ${names.get(k) ?? k} right`} disabled={i === block.columns.length - 1} onClick={() => move(i, 1)}>
                  ›
                </button>
                <button type="button" aria-label={`Remove column ${names.get(k) ?? k}`} className="font-bold" onClick={() => set({ ...block, columns: block.columns.filter((x) => x !== k) })}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            {rest.length ? (
              <select className="crm-select" aria-label="Add a column" value="" onChange={(e) => e.target.value && set({ ...block, columns: [...block.columns, e.target.value] })}>
                <option value="">Add a column…</option>
                {rest.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : null}
            <label className={check}>
              <input type="checkbox" checked={block.zebra} onChange={(e) => set({ ...block, zebra: e.target.checked })} /> Shaded rows
            </label>
            <span className="text-xs text-text-muted">The column header repeats on every page. Columns the record does not have are left out.</span>
          </div>
        </div>
      );
    }
    case "totals":
      return (
        <label className={check}>
          <input type="checkbox" checked={block.words} onChange={(e) => set({ ...block, words: e.target.checked })} /> Amount in words (Naira and Kobo)
          <span className="text-xs text-text-muted">Subtotal, VAT, total, paid and balance come from the document – they cannot be typed here.</span>
        </label>
      );
    case "payment":
      return (
        <label className={label}>
          <span>Payment terms (the brand&apos;s bank details are added from its letterhead)</span>
          <textarea className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm" rows={2} maxLength={1000} value={block.terms ?? ""} onChange={(e) => set({ ...block, terms: e.target.value })} />
        </label>
      );
    case "terms":
      return (
        <div className="space-y-1">
          <p className="text-xs text-text-muted">Leave empty to print the terms of the record itself.</p>
          {rte(block.html ?? "", (html) => set({ ...block, html: html || undefined }), "Terms and conditions")}
        </div>
      );
    case "signatures":
      return (
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            <span>Signature lines (up to 4, separated by commas)</span>
            <Input className="w-96" value={block.roles.join(", ")} onChange={(e) => set({ ...block, roles: e.target.value.split(",").map((r) => r.trim()).filter(Boolean).slice(0, 4) })} />
          </label>
          <label className={check}>
            <input type="checkbox" checked={block.stamp} onChange={(e) => set({ ...block, stamp: e.target.checked })} /> Box for the company stamp
          </label>
        </div>
      );
    case "qr":
      return (
        <label className={label}>
          <span>QR code of</span>
          <select className="crm-select" value={block.value} onChange={(e) => set({ ...block, value: e.target.value as "url" | "vin" | "number" })}>
            <option value="url">The record&apos;s address in the CRM</option>
            <option value="number">Document number</option>
            <option value="vin">VIN</option>
          </select>
        </label>
      );
    case "barcode":
      return (
        <label className={label}>
          <span>Barcode of</span>
          <select className="crm-select" value={block.value} onChange={(e) => set({ ...block, value: e.target.value as "vin" | "number" })}>
            <option value="number">Document number</option>
            <option value="vin">VIN</option>
          </select>
        </label>
      );
    case "conditional":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className={label}>
              <span>Show only if</span>
              <Input list="doc-fields" className="w-48" value={block.field} onChange={(e) => set({ ...block, field: e.target.value.trim() })} />
            </label>
            <select className="crm-select" aria-label="Condition" value={block.op} onChange={(e) => set({ ...block, op: e.target.value as ConditionOp })}>
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {CONDITION_LABELS[op]}
                </option>
              ))}
            </select>
            {block.op === "empty" || block.op === "notEmpty" ? null : <Input aria-label="Value" className="w-44" value={block.value} maxLength={120} onChange={(e) => set({ ...block, value: e.target.value })} />}
          </div>
          {rte(block.html, (html) => set({ ...block, html }), "Conditional text")}
        </div>
      );
    case "repeat":
    case "related": {
      const list = cat.lists.find((l) => l.key === block.list);
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className={label}>
              <span>Related list</span>
              <select className="crm-select" value={block.list} onChange={(e) => set({ ...block, list: e.target.value })}>
                {cat.lists.some((l) => l.key === block.list) ? null : <option value={block.list}>{block.list || "Choose…"}</option>}
                {cat.lists.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              <span>Heading (optional)</span>
              <Input value={block.title ?? ""} maxLength={80} className="w-56" onChange={(e) => set({ ...block, title: e.target.value || undefined })} />
            </label>
          </div>
          {block.type === "repeat" ? rte(block.html, (html) => set({ ...block, html }), "Text per row", ["row.index", ...(list?.columns ?? []).map((c) => `row.${c}`), ...cat.mergeFields]) : null}
        </div>
      );
    }
    case "vehicle":
      return <p className="text-xs text-text-muted">Model, variant, colour, VIN and engine number of the record – whatever of these the record has.</p>;
    case "pageBreak":
      return <p className="border-t-2 border-dashed border-border-strong pt-1 text-center text-xs text-text-muted">— the document continues on a new page —</p>;
  }
}

/**
 * The document template builder: an A4 / Letter / A5 page with a repeating header (the company letterhead is placed
 * there), body blocks and a repeating footer. Blocks are added from the side panel and moved with buttons – the whole
 * editor works from the keyboard. "Preview" renders the working copy on the server for a record the user can open.
 */
export function Builder(p: Props) {
  const router = useRouter();
  const [name, setName] = useState(p.initial.name);
  const [paper, setPaper] = useState(p.initial.paper);
  const [orientation, setOrientation] = useState(p.initial.orientation);
  const [margins, setMargins] = useState(p.initial.margins);
  const [css, setCss] = useState(() => Object.fromEntries(p.initial.cssOverrides.split(";").map((d) => d.split(":").map((x) => x.trim())).filter((d) => d.length === 2)) as Record<string, string>);
  const [content, setContent] = useState(p.initial.content);
  const [zoom, setZoom] = useState(0.85);
  const [tab, setTab] = useState<"design" | "preview">("design");
  const [preview, setPreview] = useState<string | null>(null);
  const [lint, setLint] = useState<{ errors: string[]; unknown: string[]; droppedCss: string[] } | null>(null);
  const [recordId, setRecordId] = useState(p.catalogue.sampleId ?? "");
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const keys = useRef<number[]>([]);
  const next = useRef(1);
  while (keys.current.length < content.body.length) keys.current.push(next.current++);
  keys.current.length = content.body.length;

  const disabled = !p.canEdit || !!p.locked;
  const colors = p.brandColor ? [p.brandColor] : [];
  const change = (c: DocContent, order?: number[]) => {
    if (order) keys.current = order;
    setContent(c);
    setDirty(true);
  };
  const setBody = (body: DocBlock[], order?: number[]) => change({ ...content, body }, order);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= content.body.length) return;
    const body = [...content.body];
    const order = [...keys.current];
    [body[i], body[j]] = [body[j]!, body[i]!];
    [order[i], order[j]] = [order[j]!, order[i]!];
    setBody(body, order);
  };
  const cssText = Object.entries(css).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; ");
  const state = () => ({ name, paper, orientation, margins, content, cssOverrides: cssText });
  const form = (extra: Record<string, unknown> = {}) => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ ...state(), ...extra }));
    fd.set("templateId", p.templateId);
    return fd;
  };
  const previewInput = () => ({ ...state(), module: p.module, brandId: p.brandId, recordId: recordId || null });

  const onSave = () =>
    start(async () => {
      const res = await saveDocTemplateAction(form());
      if (!res.ok) return toast(res.error.message, "error");
      toast(res.data.droppedCss.length ? `Saved – not allowed and removed: ${res.data.droppedCss.join(", ")}` : "Saved", "success");
      setDirty(false);
      router.refresh();
    });
  const onPreview = () =>
    start(async () => {
      const res = await previewDocTemplateAction(form(previewInput()));
      if (!res.ok) return toast(res.error.message, "error");
      setPreview(res.data.html);
      setLint(res.data.lint);
      setTab("preview");
    });
  const onPdf = () =>
    start(async () => {
      const res = await fetch("/api/v1/document-templates/preview-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(previewInput()) });
      if (!res.ok) return toast(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "The PDF could not be made", "error");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || "template"}-test.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const [w, h] = PAGE_MM[paper] ?? PAGE_MM.A4!;
  const [pw, ph] = orientation === "landscape" ? [h, w] : [w, h];
  const addable = (Object.keys(DOC_BLOCK_LABELS) as DocBlock["type"][]).filter((t) => (t !== "lineItems" || p.catalogue.lineColumns.length > 1) && ((t !== "related" && t !== "repeat") || p.catalogue.lists.length > 0));
  const found = p.catalogue.mergeFields.filter((f) => f.toLowerCase().includes(search.toLowerCase())).slice(0, 40);
  const num = (v: string, fallback: number) => Math.min(50, Math.max(5, Number(v) || fallback));

  return (
    <div className="space-y-3" data-testid="doc-builder">
      <datalist id="doc-fields">
        {p.catalogue.fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </datalist>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <label className={label}>
          <span>Template name</span>
          <Input value={name} maxLength={100} className="w-64" disabled={disabled} onChange={(e) => (setName(e.target.value), setDirty(true))} />
        </label>
        <label className={label}>
          <span>Paper</span>
          <select className="crm-select" value={paper} disabled={disabled} onChange={(e) => (setPaper(e.target.value), setDirty(true))}>
            <option value="A4">A4</option>
            <option value="LETTER">Letter</option>
            <option value="A5">A5 (receipt)</option>
          </select>
        </label>
        <label className={label}>
          <span>Orientation</span>
          <select className="crm-select" value={orientation} disabled={disabled} onChange={(e) => (setOrientation(e.target.value), setDirty(true))}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <fieldset className="flex items-end gap-1">
          <legend className="text-xs font-medium text-text-muted">Margins (mm)</legend>
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Input key={side} type="number" min={5} max={50} aria-label={`Margin ${side}`} title={side} className="w-16" disabled={disabled} value={margins[side]} onChange={(e) => (setMargins({ ...margins, [side]: num(e.target.value, 14) }), setDirty(true))} />
          ))}
        </fieldset>
        <label className={label}>
          <span>Font</span>
          <select className="crm-select" value={css["font-family"] ?? ""} disabled={disabled} onChange={(e) => (setCss({ ...css, "font-family": e.target.value }), setDirty(true))}>
            <option value="">Brand default (Lato)</option>
            {CSS_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Size</span>
          <select className="crm-select" value={css["font-size"] ?? ""} disabled={disabled} onChange={(e) => (setCss({ ...css, "font-size": e.target.value }), setDirty(true))}>
            <option value="">10 pt</option>
            {["8pt", "9pt", "11pt", "12pt"].map((s) => (
              <option key={s} value={s}>
                {s.replace("pt", " pt")}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Line spacing</span>
          <select className="crm-select" value={css["line-height"] ?? ""} disabled={disabled} onChange={(e) => (setCss({ ...css, "line-height": e.target.value }), setDirty(true))}>
            <option value="">Normal</option>
            <option value="1.15">Tight</option>
            <option value="1.6">Wide</option>
            <option value="2">Double</option>
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty ? <span className="text-xs text-text-muted">Unsaved changes</span> : null}
          {disabled ? (
            <span className="text-sm text-text-muted">{p.locked ?? "You can read this template but not change it."}</span>
          ) : (
            <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={onSave} data-testid="doc-save">
              {pending ? "Working…" : "Save"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex overflow-hidden rounded-md border border-border-strong">
          <button type="button" role="tab" aria-selected={tab === "design"} className={`px-3 py-1 text-xs font-semibold ${tab === "design" ? "bg-primary text-white" : "bg-surface"}`} onClick={() => setTab("design")}>
            Design
          </button>
          <button type="button" role="tab" aria-selected={tab === "preview"} className={`px-3 py-1 text-xs font-semibold ${tab === "preview" ? "bg-primary text-white" : "bg-surface"}`} onClick={onPreview} data-testid="doc-preview-tab">
            Preview
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Preview with
          <select className="crm-select" value={recordId} onChange={(e) => setRecordId(e.target.value)} aria-label="Preview with record">
            {p.catalogue.samples.length === 0 ? <option value="">No {p.moduleLabel.toLowerCase()} yet – sample page</option> : null}
            {p.catalogue.samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="crm-btn crm-btn-secondary" disabled={pending} onClick={onPreview}>
          Refresh preview
        </button>
        <button type="button" className="crm-btn crm-btn-secondary" disabled={pending || !p.catalogue.samples.length} onClick={onPdf} data-testid="doc-test-pdf">
          Download test PDF
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-text-muted">
          Zoom
          <select className="crm-select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {[0.6, 0.75, 0.85, 1, 1.25].map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)} %
              </option>
            ))}
          </select>
        </label>
      </div>

      {lint && (lint.errors.length || lint.unknown.length || lint.droppedCss.length) ? (
        <ul className="space-y-1 rounded-md border border-border bg-surface p-3 text-sm" data-testid="doc-lint" aria-label="Checks">
          {lint.errors.map((e) => (
            <li key={e} className="text-danger">
              Error: {e}
            </li>
          ))}
          {lint.unknown.length ? <li className="text-text-muted">Unknown merge fields (they print empty for this record): {lint.unknown.join(", ")}</li> : null}
          {lint.droppedCss.length ? <li className="text-text-muted">Style settings that are not allowed were ignored: {lint.droppedCss.join(", ")}</li> : null}
        </ul>
      ) : null}

      {tab === "preview" ? (
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="doc-preview">
          {preview ? <iframe title="Document preview" sandbox="" srcDoc={preview} className="h-[80vh] w-full rounded border border-border bg-white" /> : <p className="p-6 text-center text-sm text-text-muted">Rendering…</p>}
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-lg border border-border bg-surface p-2" data-testid="doc-palette">
              <h2 className="mb-1 px-1 text-[13px] font-semibold">Add to the page</h2>
              <ul className="space-y-0.5">
                {addable.map((t) => (
                  <li key={t}>
                    <button type="button" disabled={disabled || content.body.length >= 60} title={DOC_BLOCK_HINTS[t]} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-muted disabled:opacity-50" onClick={() => setBody([...content.body, NEW[t](p.catalogue)])}>
                      <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden /> {DOC_BLOCK_LABELS[t]}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-border bg-surface p-2" data-testid="doc-fields-panel">
              <h2 className="mb-1 px-1 text-[13px] font-semibold">Merge fields</h2>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields" aria-label="Search merge fields" />
              <ul className="mt-1 max-h-64 overflow-auto text-xs">
                {found.map((f) => (
                  <li key={f}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-1 py-0.5 text-left font-mono hover:bg-muted"
                      title="Copy – then paste it into a text, or use the { } button of a text block"
                      onClick={() => navigator.clipboard?.writeText(`{{${f}}}`).then(() => toast(`Copied {{${f}}}`, "success"), () => toast(`{{${f}}}`, "info"))}
                    >
                      {`{{${f}}}`}
                    </button>
                  </li>
                ))}
                {found.length === 0 ? <li className="px-1 py-1 text-text-muted">No field matches.</li> : null}
              </ul>
              <p className="mt-1 px-1 text-[11px] text-text-muted">
                Formats: <code>{`| date`}</code> <code>{`| currency`}</code> <code>{`| usd`}</code> <code>{`| number`}</code> <code>{`| upper`}</code> <code>{`| lower`}</code> <code>{`| title`}</code> <code>{`| words`}</code> · default value: <code>{`| "text"`}</code>
              </p>
            </section>
          </aside>

          <div className="overflow-auto rounded-lg border border-border bg-[#e5e7eb] p-4">
            <div
              className="mx-auto bg-white text-[#1f2937] shadow-md"
              data-testid="doc-page"
              style={{ width: pw * PX, minHeight: ph * PX, padding: `${margins.top * PX}px ${margins.right * PX}px ${margins.bottom * PX}px ${margins.left * PX}px`, zoom, fontFamily: css["font-family"] ? `"${css["font-family"]}", Arial, sans-serif` : undefined }}
            >
              {/* margin guides: the dashed frame is the printable area */}
              <div className="space-y-3 outline-dashed outline-1 outline-offset-4 outline-[#cbd5e1]">
                <section aria-label="Header (repeats on every page)" className="rounded border border-dashed border-[#94a3b8] p-2">
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#475569]">Header – repeats on every page</h3>
                  <div className="mb-2 flex flex-wrap items-center gap-3 rounded bg-[#f1f5f9] p-2 text-xs text-[#334155]">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={content.letterhead.show} disabled={disabled} onChange={(e) => change({ ...content, letterhead: { ...content.letterhead, show: e.target.checked } })} />
                      <strong>Company letterhead</strong>
                    </label>
                    <span>{p.brandId ? p.brandLabel : "of the record’s brand"} – logo, legal entity, RC no., address, phone, e-mail, website, VAT no.</span>
                    {content.letterhead.show ? (
                      <>
                        <label className="flex items-center gap-1">
                          Logo
                          <select className="crm-select" value={content.letterhead.logo} disabled={disabled} onChange={(e) => change({ ...content, letterhead: { ...content.letterhead, logo: e.target.value as "left" | "center" | "right" } })}>
                            <option value="left">left</option>
                            <option value="center">centre</option>
                            <option value="right">right</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1">
                          Details
                          <select className="crm-select" value={content.letterhead.details} disabled={disabled} onChange={(e) => change({ ...content, letterhead: { ...content.letterhead, details: e.target.value as "beside" | "below" } })}>
                            <option value="beside">beside the logo</option>
                            <option value="below">below the logo</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                  </div>
                  <RichTextEditor label="Header text" value={content.header} onChange={(header) => change({ ...content, header })} mergeFields={p.catalogue.mergeFields} allowHtml={p.allowHtml} maxImageBytes={300 * 1024} minHeight={50} extraColors={colors} />
                </section>

                <section aria-label="Body" className="space-y-2" data-testid="doc-body">
                  {content.body.map((block, i) => (
                    <section key={keys.current[i]} className="rounded border border-[#cbd5e1] bg-white" aria-label={`Block ${i + 1}: ${DOC_BLOCK_LABELS[block.type]}`} data-block={block.type}>
                      <header className="flex items-center gap-1 border-b border-[#e2e8f0] bg-[#f8fafc] px-2 py-1">
                        <span className="text-xs font-semibold text-[#475569]">{DOC_BLOCK_LABELS[block.type]}</span>
                        <span className="ml-auto" />
                        <button type="button" className="crm-icon-btn" aria-label={`Move block ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp />
                        </button>
                        <button type="button" className="crm-icon-btn" aria-label={`Move block ${i + 1} down`} disabled={disabled || i === content.body.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown />
                        </button>
                        <button
                          type="button"
                          className="crm-icon-btn"
                          aria-label={`Remove block ${i + 1}`}
                          disabled={disabled || content.body.length === 1}
                          onClick={() =>
                            setBody(
                              content.body.filter((_, j) => j !== i),
                              keys.current.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <Trash2 />
                        </button>
                      </header>
                      <div className="p-2">
                        <BlockEditor block={block} set={(b) => setBody(content.body.map((x, j) => (j === i ? b : x)))} cat={p.catalogue} color={colors} allowHtml={p.allowHtml} />
                      </div>
                    </section>
                  ))}
                </section>

                <section aria-label="Footer (repeats on every page)" className="rounded border border-dashed border-[#94a3b8] p-2">
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                    Footer – repeats on every page · a line with {"{{page}}"} / {"{{pages}}"} becomes the page number
                  </h3>
                  <RichTextEditor label="Footer text" value={content.footer} onChange={(footer) => change({ ...content, footer })} mergeFields={["page", "pages", ...p.catalogue.mergeFields]} allowHtml={p.allowHtml} minHeight={50} extraColors={colors} />
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
