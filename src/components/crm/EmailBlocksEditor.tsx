"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { Input } from "@/components/ui/input";
import { EMAIL_BLOCK_LABELS, type EmailBlock, type EmailDoc } from "@/server/modules/email/blocks";
import { RichTextEditor } from "./RichTextEditor";

const MAX_IMAGE = 300 * 1024;

const NEW_BLOCK: { [K in EmailBlock["type"]]: () => Extract<EmailBlock, { type: K }> } = {
  text: () => ({ type: "text", html: "<p></p>" }),
  hero: () => ({ type: "hero", url: "", alt: "" }),
  columns: () => ({ type: "columns", left: "<p>Left column</p>", right: "<p>Right column</p>" }),
  vehicle: () => ({ type: "vehicle", model: "Model name", price: "", description: "", cta: "Book a test drive", href: "mailto:{{user.email}}" }),
  button: () => ({ type: "button", label: "Find out more", href: "https://" }),
  divider: () => ({ type: "divider" }),
  spacer: () => ({ type: "spacer", height: 16 }),
  social: () => ({ type: "social", links: [{ label: "Website", href: "https://" }] }),
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Picks an image file and returns it as a data: address (sent as an inline attachment, never as a remote link). */
function ImagePick({ label, onPick }: { label: string; onPick: (src: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="crm-btn crm-btn-secondary" onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > MAX_IMAGE) return toast("The image is larger than 300 KB – use a smaller one", "error");
          const reader = new FileReader();
          reader.onload = () => onPick(String(reader.result));
          reader.readAsDataURL(file);
        }}
      />
    </>
  );
}

function BlockFields({ block, set, mergeFields, allowHtml }: { block: EmailBlock; set: (b: EmailBlock) => void; mergeFields: string[]; allowHtml: boolean }) {
  switch (block.type) {
    case "text":
      return <RichTextEditor label="E-mail text" value={block.html} onChange={(html) => set({ ...block, html })} mergeFields={mergeFields} allowHtml={allowHtml} maxImageBytes={MAX_IMAGE} minHeight={140} />;
    case "columns":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <RichTextEditor label="Left column" value={block.left} onChange={(left) => set({ ...block, left })} mergeFields={mergeFields} maxImageBytes={MAX_IMAGE} minHeight={100} />
          <RichTextEditor label="Right column" value={block.right} onChange={(right) => set({ ...block, right })} mergeFields={mergeFields} maxImageBytes={MAX_IMAGE} minHeight={100} />
        </div>
      );
    case "hero":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="flex items-end gap-2">
            <ImagePick label={block.url ? "Replace image" : "Choose image"} onPick={(url) => set({ ...block, url })} />
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data: preview */}
            {block.url ? <img src={block.url} alt="" className="h-10 rounded border border-border" /> : <span className="text-xs text-text-muted">PNG, JPEG, GIF or WebP up to 300 KB</span>}
          </div>
          <Field label="Alternative text (required)">
            <Input value={block.alt} maxLength={200} onChange={(e) => set({ ...block, alt: e.target.value })} />
          </Field>
          <Field label="Link (optional)">
            <Input value={block.href ?? ""} placeholder="https://" onChange={(e) => set({ ...block, href: e.target.value || undefined })} />
          </Field>
        </div>
      );
    case "vehicle":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Model">
            <Input value={block.model} maxLength={120} onChange={(e) => set({ ...block, model: e.target.value })} />
          </Field>
          <Field label="Price line">
            <Input value={block.price} maxLength={80} onChange={(e) => set({ ...block, price: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <Input value={block.description ?? ""} maxLength={400} onChange={(e) => set({ ...block, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Button text">
            <Input value={block.cta} maxLength={60} onChange={(e) => set({ ...block, cta: e.target.value })} />
          </Field>
          <Field label="Button link">
            <Input value={block.href} onChange={(e) => set({ ...block, href: e.target.value })} />
          </Field>
          <div className="flex items-center gap-2">
            <ImagePick label={block.image ? "Replace picture" : "Add picture"} onPick={(image) => set({ ...block, image })} />
            {block.image ? (
              <button type="button" className="text-xs text-primary underline" onClick={() => set({ ...block, image: undefined })}>
                Remove picture
              </button>
            ) : null}
          </div>
        </div>
      );
    case "button":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Button text">
            <Input value={block.label} maxLength={60} onChange={(e) => set({ ...block, label: e.target.value })} />
          </Field>
          <Field label="Link">
            <Input value={block.href} onChange={(e) => set({ ...block, href: e.target.value })} />
          </Field>
        </div>
      );
    case "spacer":
      return (
        <Field label="Height (4–80 px)">
          <Input type="number" min={4} max={80} value={block.height} className="w-28" onChange={(e) => set({ ...block, height: Math.min(80, Math.max(4, Number(e.target.value) || 16)) })} />
        </Field>
      );
    case "social":
      return (
        <div className="space-y-2">
          {block.links.map((l, i) => (
            <div key={i} className="grid grid-cols-[160px_1fr_auto] items-end gap-2">
              <Field label="Name">
                <Input value={l.label} maxLength={40} onChange={(e) => set({ ...block, links: block.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              </Field>
              <Field label="Link">
                <Input value={l.href} onChange={(e) => set({ ...block, links: block.links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} />
              </Field>
              <button type="button" className="crm-icon-btn" aria-label={`Remove link ${i + 1}`} onClick={() => set({ ...block, links: block.links.filter((_, j) => j !== i) })}>
                <Trash2 />
              </button>
            </div>
          ))}
          {block.links.length < 8 ? (
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => set({ ...block, links: [...block.links, { label: "", href: "https://" }] })}>
              + Add link
            </button>
          ) : null}
        </div>
      );
    default:
      return <p className="text-xs text-text-muted">A thin line across the e-mail.</p>;
  }
}

/**
 * The e-mail body as a list of blocks (text, hero image, two columns, vehicle card, button, divider, spacer, social
 * links). Blocks are added, moved and removed with buttons – everything works from the keyboard. The brand header and
 * footer are not part of the document: the brand layout adds them when the e-mail is rendered.
 */
export function EmailBlocksEditor({ doc, onChange, mergeFields, allowHtml = false }: { doc: EmailDoc; onChange: (doc: EmailDoc) => void; mergeFields: string[]; allowHtml?: boolean }) {
  // stable keys for the editors while blocks move
  const keys = useRef<number[]>([]);
  const next = useRef(1);
  while (keys.current.length < doc.blocks.length) keys.current.push(next.current++);
  keys.current.length = doc.blocks.length;
  const [add, setAdd] = useState<EmailBlock["type"]>("text");

  const update = (blocks: EmailBlock[], order?: number[]) => {
    if (order) keys.current = order;
    onChange({ blocks });
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    const order = [...keys.current];
    [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
    [order[i], order[j]] = [order[j]!, order[i]!];
    update(blocks, order);
  };

  return (
    <div className="space-y-2" data-testid="email-blocks">
      {doc.blocks.map((block, i) => (
        <section key={keys.current[i]} className="rounded-md border border-border bg-surface" aria-label={`Block ${i + 1}: ${EMAIL_BLOCK_LABELS[block.type]}`} data-block={block.type}>
          <header className="flex items-center gap-1 border-b border-border bg-surface-alt px-2 py-1">
            <span className="text-xs font-semibold text-text-muted">{EMAIL_BLOCK_LABELS[block.type]}</span>
            <span className="ml-auto" />
            <button type="button" className="crm-icon-btn" aria-label={`Move block ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </button>
            <button type="button" className="crm-icon-btn" aria-label={`Move block ${i + 1} down`} disabled={i === doc.blocks.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </button>
            <button
              type="button"
              className="crm-icon-btn"
              aria-label={`Remove block ${i + 1}`}
              disabled={doc.blocks.length === 1}
              onClick={() =>
                update(
                  doc.blocks.filter((_, j) => j !== i),
                  keys.current.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2 />
            </button>
          </header>
          <div className="p-2">
            <BlockFields block={block} set={(b) => update(doc.blocks.map((x, j) => (j === i ? b : x)))} mergeFields={mergeFields} allowHtml={allowHtml} />
          </div>
        </section>
      ))}
      {doc.blocks.length < 40 ? (
        <div className="flex items-center gap-2">
          <select className="crm-select" aria-label="Block to add" value={add} onChange={(e) => setAdd(e.target.value as EmailBlock["type"])}>
            {(Object.keys(EMAIL_BLOCK_LABELS) as Array<EmailBlock["type"]>).map((t) => (
              <option key={t} value={t}>
                {EMAIL_BLOCK_LABELS[t]}
              </option>
            ))}
          </select>
          <button type="button" className="crm-btn crm-btn-secondary" onClick={() => update([...doc.blocks, NEW_BLOCK[add]()])}>
            <Plus aria-hidden /> Add block
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Desktop (600 px) / mobile (360 px) preview of a rendered e-mail in a sandboxed frame. */
export function EmailPreview({ html, subject }: { html: string | null; subject?: string }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div data-testid="email-preview">
      <div className="mb-2 flex items-center gap-2">
        <div role="group" aria-label="Preview width" className="flex overflow-hidden rounded-md border border-border-strong">
          <button type="button" aria-pressed={!mobile} className={`px-3 py-1 text-xs font-semibold ${mobile ? "bg-surface" : "bg-primary text-white"}`} onClick={() => setMobile(false)}>
            Desktop
          </button>
          <button type="button" aria-pressed={mobile} className={`px-3 py-1 text-xs font-semibold ${mobile ? "bg-primary text-white" : "bg-surface"}`} onClick={() => setMobile(true)}>
            Mobile
          </button>
        </div>
        {subject ? <span className="truncate text-xs text-text-muted">Subject: {subject}</span> : null}
      </div>
      {html ? (
        <iframe title="E-mail preview" sandbox="" srcDoc={html} className="mx-auto block rounded-md border border-border bg-white" style={{ width: mobile ? 360 : "100%", maxWidth: "100%", height: 560 }} />
      ) : (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">Choose “Preview” to see the e-mail as the customer gets it.</p>
      )}
    </div>
  );
}
