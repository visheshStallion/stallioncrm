"use client";

import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { AlignCenter, AlignLeft, AlignRight, Bold, Braces, Code2, Highlighter, ImageIcon, Italic, Link2, List, ListOrdered, Minus, MousePointerClick, Redo2, Strikethrough, Table2, Underline, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Rich-text editor (TipTap / ProseMirror, open source) used by the e-mail composer, the e-mail template editor,
 * signatures and the rich-text blocks of print templates. It produces HTML; the server sanitises that HTML again
 * before it is stored or sent (src/server/modules/print/sanitize.ts) – nothing here is trusted.
 *
 * Paste from Word / Gmail is cleaned by the editor's schema: only the marks and nodes below survive.
 */
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** merge fields offered by the "{ }" button, e.g. "contact.firstName" */
  mergeFields?: string[];
  /** HTML source view – administrators only */
  allowHtml?: boolean;
  /** uploads are embedded in the document (PNG / JPEG / GIF / WebP, at most this many bytes) */
  maxImageBytes?: number;
  minHeight?: number;
  label: string;
}

const SIZES = ["12px", "14px", "16px", "18px", "24px", "32px"];
const COLORS = ["#111827", "#374151", "#1565d0", "#c9282d", "#1e7e45", "#b45309", "#7c3aed"];
const BUTTON_STYLE = "display:inline-block;padding:10px 18px;background-color:#1565d0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold";

function Btn({ on, active, label, children, disabled }: { on: () => void; active?: boolean; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={on} disabled={disabled} aria-label={label} title={label} aria-pressed={active} className={cn("flex h-7 min-w-7 items-center justify-center rounded px-1 text-text hover:bg-surface-alt disabled:opacity-40", active && "bg-primary-soft text-primary")}>
      {children}
    </button>
  );
}

function Toolbar({ editor, props, html, setHtml }: { editor: Editor; props: RichTextEditorProps; html: boolean; setHtml: (v: boolean) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState(false);
  const chain = () => editor.chain().focus();
  const link = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "https://";
    const url = window.prompt("Link address (https://…)", prev);
    if (url === null) return;
    if (!url.trim()) chain().unsetLink().run();
    else if (/^(https?:|mailto:|tel:)/i.test(url.trim())) chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
    else window.alert("A link must start with https://, http://, mailto: or tel:");
  };
  const button = () => {
    const text = window.prompt("Button text", "View the offer");
    if (!text) return;
    const url = window.prompt("Button link (https://…)", "https://");
    if (!url || !/^https?:/i.test(url.trim())) return;
    chain().insertContent(`<p><a href="${url.trim().replace(/"/g, "&quot;")}" data-button="1" style="${BUTTON_STYLE}">${text.replace(/</g, "&lt;")}</a></p>`).run();
  };
  const imageUrl = () => {
    const url = window.prompt("Image address (https://…)");
    if (!url || !/^https:/i.test(url.trim())) return;
    const alt = window.prompt("Describe the image (alternative text – required)") ?? "";
    if (!alt.trim()) return window.alert("An image needs alternative text");
    chain().setImage({ src: url.trim(), alt: alt.trim() }).run();
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return window.alert("Upload a PNG, JPEG, GIF or WebP image");
    if (f.size > (props.maxImageBytes ?? 300_000)) return window.alert(`The image is larger than ${Math.round((props.maxImageBytes ?? 300_000) / 1000)} KB`);
    const alt = window.prompt("Describe the image (alternative text – required)", f.name.replace(/\.[a-z]+$/i, "")) ?? "";
    if (!alt.trim()) return window.alert("An image needs alternative text");
    const reader = new FileReader();
    reader.onload = () => chain().setImage({ src: String(reader.result), alt: alt.trim() }).run();
    reader.readAsDataURL(f);
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-alt px-1 py-1" role="toolbar" aria-label={`${props.label} formatting`}>
      <Btn label="Undo" on={() => chain().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 className="h-4 w-4" />
      </Btn>
      <Btn label="Redo" on={() => chain().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 className="h-4 w-4" />
      </Btn>
      <select aria-label="Paragraph style" className="h-7 rounded border border-border bg-surface px-1 text-xs" value={editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "p"} onChange={(e) => (e.target.value === "p" ? chain().setParagraph().run() : chain().setHeading({ level: Number(e.target.value) as 1 | 2 | 3 }).run())}>
        <option value="p">Normal</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <select aria-label="Font size" className="h-7 rounded border border-border bg-surface px-1 text-xs" value={(editor.getAttributes("textStyle").fontSize as string | undefined) ?? ""} onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}>
        <option value="">Size</option>
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s.replace("px", "")}
          </option>
        ))}
      </select>
      <Btn label="Bold" active={editor.isActive("bold")} on={() => chain().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </Btn>
      <Btn label="Italic" active={editor.isActive("italic")} on={() => chain().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </Btn>
      <Btn label="Underline" active={editor.isActive("underline")} on={() => chain().toggleUnderline().run()}>
        <Underline className="h-4 w-4" />
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive("strike")} on={() => chain().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </Btn>
      <select aria-label="Text colour" className="h-7 rounded border border-border bg-surface px-1 text-xs" value={(editor.getAttributes("textStyle").color as string | undefined) ?? ""} onChange={(e) => (e.target.value ? chain().setColor(e.target.value).run() : chain().unsetColor().run())}>
        <option value="">Colour</option>
        {COLORS.map((c) => (
          <option key={c} value={c} style={{ color: c }}>
            ■ {c}
          </option>
        ))}
      </select>
      <Btn label="Highlight" active={editor.isActive("highlight")} on={() => chain().toggleHighlight().run()}>
        <Highlighter className="h-4 w-4" />
      </Btn>
      <Btn label="Align left" active={editor.isActive({ textAlign: "left" })} on={() => chain().setTextAlign("left").run()}>
        <AlignLeft className="h-4 w-4" />
      </Btn>
      <Btn label="Align centre" active={editor.isActive({ textAlign: "center" })} on={() => chain().setTextAlign("center").run()}>
        <AlignCenter className="h-4 w-4" />
      </Btn>
      <Btn label="Align right" active={editor.isActive({ textAlign: "right" })} on={() => chain().setTextAlign("right").run()}>
        <AlignRight className="h-4 w-4" />
      </Btn>
      <Btn label="Bullet list" active={editor.isActive("bulletList")} on={() => chain().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </Btn>
      <Btn label="Numbered list" active={editor.isActive("orderedList")} on={() => chain().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </Btn>
      <Btn label="Link" active={editor.isActive("link")} on={link}>
        <Link2 className="h-4 w-4" />
      </Btn>
      <Btn label="Button (call to action)" on={button}>
        <MousePointerClick className="h-4 w-4" />
      </Btn>
      <Btn label="Table" on={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table2 className="h-4 w-4" />
      </Btn>
      <Btn label="Horizontal rule" on={() => chain().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </Btn>
      <Btn label="Image from an address" on={imageUrl}>
        <ImageIcon className="h-4 w-4" />
      </Btn>
      <button type="button" className="h-7 rounded px-1.5 text-xs hover:bg-surface" onClick={() => file.current?.click()}>
        Upload image
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label="Upload an image" onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
      {props.mergeFields?.length ? (
        <span className="relative">
          <Btn label="Insert merge field" active={fields} on={() => setFields((v) => !v)}>
            <Braces className="h-4 w-4" />
          </Btn>
          {fields ? (
            <span className="crm-menu left-0 max-h-64 w-64 overflow-y-auto" role="menu" aria-label="Merge fields" data-testid="merge-fields">
              {props.mergeFields.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  className="crm-menu-item font-mono text-xs"
                  onClick={() => {
                    // with a fallback for the customer's name, as the brief asks: {{contact.firstName | "Customer"}}
                    chain().insertContent(/firstName$/.test(f) ? `{{${f} | "Customer"}}` : `{{${f}}}`).run();
                    setFields(false);
                  }}
                >
                  {`{{${f}}}`}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
      {props.allowHtml ? (
        <Btn label="HTML source" active={html} on={() => setHtml(!html)}>
          <Code2 className="h-4 w-4" />
        </Btn>
      ) : null}
    </div>
  );
}

export function RichTextEditor(props: RichTextEditorProps) {
  const [html, setHtml] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } } }), TextStyle, Color, FontSize, Highlight, TextAlign.configure({ types: ["heading", "paragraph"] }), Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: false } })],
    content: props.value,
    editorProps: { attributes: { class: "rich-editor-content", role: "textbox", "aria-multiline": "true", "aria-label": props.label } },
    onUpdate: ({ editor: e }) => props.onChange(e.isEmpty ? "" : e.getHTML()),
  });
  // a new value from outside (template chosen, version restored) replaces the document
  useEffect(() => {
    if (editor && props.value !== (editor.isEmpty ? "" : editor.getHTML())) editor.commands.setContent(props.value, { emitUpdate: false });
  }, [props.value, editor]);

  return (
    <div className="overflow-hidden rounded-md border border-border-strong bg-surface" data-testid="rich-editor">
      {editor ? <Toolbar editor={editor} props={props} html={html} setHtml={setHtml} /> : <div className="h-9 border-b border-border bg-surface-alt" />}
      {html ? (
        <textarea className="block w-full p-3 font-mono text-xs outline-none" style={{ minHeight: props.minHeight ?? 180 }} value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={`${props.label} (HTML source)`} spellCheck={false} />
      ) : (
        <EditorContent editor={editor} style={{ minHeight: props.minHeight ?? 180 }} />
      )}
    </div>
  );
}
