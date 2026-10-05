"use client";

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { RichTextEditor } from "@/components/crm/RichTextEditor";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createTemplateAction, publishTemplateAction, saveTemplateDraftAction } from "@/server/modules/print/actions";
import type { Orientation, Paper, PrintBlock, PrintLayout } from "@/server/modules/print/blocks";

export interface DesignerCatalogue {
  sampleId: string | null;
  sampleTitle: string | null;
  fields: Array<{ key: string; label: string }>;
  lists: Array<{ key: string; label: string }>;
  hasLines: boolean;
  mergeFields: string[];
}

const LABELS: Record<PrintBlock["type"], string> = {
  letterhead: "Letterhead header",
  title: "Title",
  fields: "Field grid",
  richText: "Rich text",
  lineItems: "Line-items table",
  related: "Related list table",
  totals: "Totals",
  terms: "Terms & conditions",
  signatures: "Signature boxes",
  qr: "QR code",
  barcode: "Barcode",
  image: "Image",
  pageBreak: "Page break",
  footer: "Footer text",
};

function newBlock(type: PrintBlock["type"], cat: DesignerCatalogue): PrintBlock {
  switch (type) {
    case "title":
      return { type, text: "{{record.name}}" };
    case "fields":
      return { type, columns: 2, fields: cat.fields.slice(0, 6).map((f) => f.key) };
    case "richText":
      return { type, html: "<p>Text…</p>" };
    case "related":
      return { type, list: cat.lists[0]?.key ?? "" };
    case "terms":
      return { type };
    case "signatures":
      return { type, roles: ["Customer", "Sales Executive", "Brand Manager"] };
    case "qr":
      return { type, value: "url" };
    case "barcode":
      return { type, value: "number" };
    case "image":
      return { type, url: "", alt: "", widthMm: 60 };
    case "footer":
      return { type, text: "Thank you for your business." };
    default:
      return { type } as PrintBlock;
  }
}

const summary = (b: PrintBlock): string => {
  if (b.type === "title") return b.text;
  if (b.type === "fields") return `${b.fields.length} field(s), ${b.columns} column(s)`;
  if (b.type === "richText") return b.html.replace(/<[^>]+>/g, " ").trim().slice(0, 40);
  if (b.type === "related") return b.list;
  if (b.type === "signatures") return b.roles.join(", ");
  if (b.type === "qr" || b.type === "barcode") return b.value;
  if (b.type === "image") return b.alt || "no image yet";
  if (b.type === "footer") return b.text;
  return "";
};

/** Print template designer: blocks on the left, the settings of the selected block, and a live preview. */
export function Designer(props: {
  templateId: string | null;
  module: string;
  moduleLabel: string;
  brandId: string | null;
  brandLabel: string;
  initial: { name: string; paper: Paper; orientation: Orientation; layout: PrintLayout };
  catalogue: DesignerCatalogue;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.initial.name);
  const [paper, setPaper] = useState<Paper>(props.initial.paper);
  const [orientation, setOrientation] = useState<Orientation>(props.initial.orientation);
  const [blocks, setBlocks] = useState<PrintBlock[]>(props.initial.layout.blocks);
  const [selected, setSelected] = useState(0);
  const [recordId, setRecordId] = useState(props.catalogue.sampleId ?? "");
  const [preview, setPreview] = useState("");
  const [busy, start] = useTransition();
  const dragFrom = useRef<number | null>(null);
  const cat = props.catalogue;

  // live preview: the server renders the layout with a record the designer can open
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/print/preview", { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: props.module, layout: { blocks }, brandId: props.brandId, paper, orientation, recordId: recordId || null }) });
        if (res.ok) setPreview(await res.text());
        else setPreview(`<p style="font:14px Arial;padding:24px;color:#b3262b">${((await res.json()) as { error?: { message?: string } }).error?.message ?? "The preview could not be rendered"}</p>`);
      } catch {
        /* superseded by a newer change */
      }
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [blocks, paper, orientation, recordId, props.module, props.brandId]);

  const update = (i: number, next: PrintBlock) => setBlocks((bs) => bs.map((b, j) => (j === i ? next : b)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    setBlocks((bs) => {
      const n = [...bs];
      const [m] = n.splice(from, 1);
      n.splice(to, 0, m!);
      return n;
    });
    setSelected(to);
  };
  const payload = () => ({ name, paper, orientation, layout: { blocks } });
  const save = (publish: boolean) =>
    start(async () => {
      if (!props.templateId) {
        const res = await createTemplateAction({ module: props.module, brandId: props.brandId, ...payload() });
        if (!res.ok) return toast(res.error.message, "error");
        if (publish) {
          const pub = await publishTemplateAction(res.data.id, payload());
          toast(pub.ok ? pub.data.message : pub.error.message, pub.ok ? "success" : "error");
        } else toast("Template created as a draft", "success");
        return router.push(`/setup/print-templates/${res.data.id}`);
      }
      const res = publish ? await publishTemplateAction(props.templateId, payload()) : await saveTemplateDraftAction(props.templateId, payload());
      toast(res.ok ? res.data.message : res.error.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });

  const b = blocks[selected];
  const addable = (Object.keys(LABELS) as PrintBlock["type"][]).filter((t) => (t !== "lineItems" || cat.hasLines) && (t !== "related" || cat.lists.length > 0));

  return (
    <div className="space-y-3" data-testid="print-designer">
      <div className="crm-section flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label htmlFor="tpl-name">Template name</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} className="w-64" disabled={!props.canEdit} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-paper">Paper</Label>
          <Select id="tpl-paper" value={paper} onChange={(e) => setPaper(e.target.value as Paper)} disabled={!props.canEdit}>
            <option value="A4">A4</option>
            <option value="LETTER">Letter</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-orientation">Orientation</Label>
          <Select id="tpl-orientation" value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)} disabled={!props.canEdit}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </Select>
        </div>
        <div className="text-sm text-text-muted">
          {props.moduleLabel} · {props.brandLabel}
        </div>
        <div className="ml-auto flex gap-2">
          {props.canEdit ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => save(false)}>
                Save draft
              </Button>
              <Button type="button" disabled={busy} onClick={() => save(true)}>
                Publish
              </Button>
            </>
          ) : (
            <span className="text-sm text-text-muted">Read-only: templates for all brands are managed by administrators</span>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[260px_minmax(280px,1fr)_minmax(420px,1.4fr)]">
        {/* blocks */}
        <div className="crm-section p-2" data-testid="designer-blocks">
          <ol className="space-y-1">
            {blocks.map((blk, i) => (
              <li
                key={i}
                draggable={props.canEdit}
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragFrom.current !== null && move(dragFrom.current, i)}
                className={cn("flex items-center gap-1 rounded border px-1.5 py-1 text-sm", i === selected ? "border-primary bg-primary-soft" : "border-border")}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-text-subtle" aria-hidden="true" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(i)} aria-current={i === selected ? "true" : undefined}>
                  <span className="block font-bold">{LABELS[blk.type]}</span>
                  <span className="block truncate text-xs text-text-muted">{summary(blk)}</span>
                </button>
                {props.canEdit ? (
                  <>
                    <button type="button" aria-label={`Move ${LABELS[blk.type]} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${LABELS[blk.type]} down`} disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)} className="disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${LABELS[blk.type]}`}
                      disabled={blocks.length === 1}
                      onClick={() => {
                        setBlocks((bs) => bs.filter((_, j) => j !== i));
                        setSelected((s) => Math.max(0, s >= i ? s - 1 : s));
                      }}
                      className="disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          {props.canEdit ? (
            <div className="mt-2 flex items-center gap-1">
              <Plus className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <Select
                aria-label="Add a block"
                className="w-full"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  setBlocks((bs) => [...bs, newBlock(e.target.value as PrintBlock["type"], cat)]);
                  setSelected(blocks.length);
                }}
              >
                <option value="">Add a block…</option>
                {addable.map((t) => (
                  <option key={t} value={t}>
                    {LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>

        {/* settings of the selected block */}
        <div className="crm-section space-y-3 p-3 text-sm" data-testid="designer-settings">
          {!b ? (
            <p className="text-text-muted">Select a block.</p>
          ) : (
            <fieldset disabled={!props.canEdit} className="space-y-3">
              <legend className="font-bold">{LABELS[b.type]}</legend>
              {b.type === "letterhead" ? <p className="text-text-muted">Logo left, company details right and a rule in the brand colour – from the Letterhead of the record&apos;s brand. Nothing to set here.</p> : null}
              {b.type === "title" || b.type === "footer" ? (
                <div className="space-y-1">
                  <Label htmlFor="blk-text">Text (merge fields allowed)</Label>
                  <Input id="blk-text" value={b.text} onChange={(e) => update(selected, { ...b, text: e.target.value })} />
                </div>
              ) : null}
              {b.type === "fields" || b.type === "lineItems" || b.type === "related" ? (
                <div className="space-y-1">
                  <Label htmlFor="blk-title">Heading (optional)</Label>
                  <Input id="blk-title" value={b.title ?? ""} onChange={(e) => update(selected, { ...b, title: e.target.value || undefined })} />
                </div>
              ) : null}
              {b.type === "fields" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="blk-cols">Columns</Label>
                    <Select id="blk-cols" value={String(b.columns)} onChange={(e) => update(selected, { ...b, columns: Number(e.target.value) as 1 | 2 | 3 })}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </Select>
                  </div>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto rounded border border-border p-2" role="group" aria-label="Fields">
                    {cat.fields.length === 0 ? <p className="text-text-muted">No record of this module to read the fields from.</p> : null}
                    {cat.fields.map((f) => (
                      <label key={f.key} className="flex items-center gap-2">
                        <input type="checkbox" checked={b.fields.includes(f.key)} onChange={() => update(selected, { ...b, fields: b.fields.includes(f.key) ? b.fields.filter((k) => k !== f.key) : [...b.fields, f.key] })} /> {f.label}
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
              {b.type === "richText" ? <RichTextEditor label="Rich text" value={b.html} onChange={(html) => update(selected, { ...b, html })} mergeFields={cat.mergeFields} allowHtml={props.isAdmin} /> : null}
              {b.type === "terms" ? (
                <>
                  <p className="text-text-muted">Leave empty to print the terms stored on the document. The brand&apos;s bank details follow automatically.</p>
                  <RichTextEditor label="Terms" value={b.html ?? ""} onChange={(html) => update(selected, { ...b, html: html || undefined })} mergeFields={cat.mergeFields} allowHtml={props.isAdmin} minHeight={120} />
                </>
              ) : null}
              {b.type === "related" ? (
                <div className="space-y-1">
                  <Label htmlFor="blk-list">Related list</Label>
                  <Select id="blk-list" value={b.list} onChange={(e) => update(selected, { ...b, list: e.target.value })}>
                    {cat.lists.map((l) => (
                      <option key={l.key} value={l.key}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {b.type === "lineItems" ? <p className="text-text-muted">The document&apos;s lines; the header row repeats on every page.</p> : null}
              {b.type === "totals" ? <p className="text-text-muted">Subtotal, discount, VAT, total, paid and balance – whichever the record has. Computed by the server, never typed.</p> : null}
              {b.type === "signatures" ? (
                <div className="space-y-1">
                  <Label htmlFor="blk-roles">Who signs (comma separated, at most four)</Label>
                  <Input id="blk-roles" value={b.roles.join(", ")} onChange={(e) => update(selected, { ...b, roles: e.target.value.split(",").map((r) => r.trim()).filter(Boolean).slice(0, 4) })} />
                </div>
              ) : null}
              {b.type === "qr" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="blk-qr">Content</Label>
                    <Select id="blk-qr" value={b.value} onChange={(e) => update(selected, { ...b, value: e.target.value as "url" | "vin" | "number" })}>
                      <option value="url">Link to the record</option>
                      <option value="vin">VIN</option>
                      <option value="number">Document number</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="blk-caption">Caption</Label>
                    <Input id="blk-caption" value={b.caption ?? ""} onChange={(e) => update(selected, { ...b, caption: e.target.value || undefined })} />
                  </div>
                </>
              ) : null}
              {b.type === "barcode" ? (
                <div className="space-y-1">
                  <Label htmlFor="blk-bar">Content</Label>
                  <Select id="blk-bar" value={b.value} onChange={(e) => update(selected, { ...b, value: e.target.value as "vin" | "number" })}>
                    <option value="number">Document number</option>
                    <option value="vin">VIN</option>
                  </Select>
                </div>
              ) : null}
              {b.type === "image" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="blk-img">Image (PNG, JPEG, GIF or WebP, at most 300 KB)</Label>
                    <input
                      id="blk-img"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="block text-sm"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 300_000) return toast("The image is larger than 300 KB", "error");
                        const reader = new FileReader();
                        reader.onload = () => update(selected, { ...b, url: String(reader.result), alt: b.alt || f.name.replace(/\.[a-z]+$/i, "") });
                        reader.readAsDataURL(f);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="blk-alt">Description (alternative text)</Label>
                    <Input id="blk-alt" value={b.alt} onChange={(e) => update(selected, { ...b, alt: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="blk-width">Width (mm)</Label>
                    <Input id="blk-width" type="number" min={10} max={180} value={b.widthMm} onChange={(e) => update(selected, { ...b, widthMm: Math.min(180, Math.max(10, Number(e.target.value) || 60)) })} className="w-28" />
                  </div>
                </>
              ) : null}
              {b.type === "pageBreak" ? <p className="text-text-muted">What follows starts on a new page.</p> : null}
              {b.type === "title" || b.type === "footer" ? <p className="text-xs text-text-muted">Merge fields: {cat.mergeFields.slice(0, 12).map((f) => `{{${f}}}`).join("  ")} … Formats: {"{{deal.amount | currency}}"}, {"{{x | date}}"}, {"{{x | upper}}"}; fallback: {'{{contact.firstName | "Customer"}}'}</p> : null}
            </fieldset>
          )}
        </div>

        {/* live preview */}
        <div className="crm-section p-2" data-testid="designer-preview">
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="preview-record">Preview with record #</Label>
              <Input id="preview-record" value={recordId} onChange={(e) => setRecordId(e.target.value.trim())} className="w-64" placeholder="id of a record you can open" />
            </div>
            <span className="pb-1.5 text-xs text-text-muted">{cat.sampleTitle ? `Sample: ${cat.sampleTitle}` : "No record of this module yet"}</span>
          </div>
          <iframe title="Live preview" srcDoc={preview} sandbox="" className="h-[70vh] w-full rounded border border-border bg-white" />
        </div>
      </div>
    </div>
  );
}
