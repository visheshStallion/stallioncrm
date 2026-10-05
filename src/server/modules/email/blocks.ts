/**
 * E-mail documents (prompt 20 Part B): an e-mail – in the composer and in a template – is a list of blocks.
 * This file renders them to client-safe HTML: table-based, inline CSS only, 600 px wide, explicit colours so dark
 * mode cannot make text unreadable, alternative text on every image. Pure – no database, no network.
 *
 * The brand layout (logo header, colour bar, footer with legal entity, address and – for marketing – the
 * unsubscribe link) is wrapped around the blocks automatically: the sender cannot remove or fake it.
 * HTML inside "text" / "columns" blocks is sanitised by the service before it gets here; merged values are escaped.
 */
import { escapeHtml as esc, renderMerge, renderMergeHtml, type MergeData } from "@/server/modules/messaging/merge";

export type EmailBlock =
  | { type: "text"; html: string }
  | { type: "hero"; url: string; alt: string; href?: string }
  | { type: "columns"; left: string; right: string }
  | { type: "vehicle"; image?: string; model: string; price: string; description?: string; cta: string; href: string }
  | { type: "button"; label: string; href: string }
  | { type: "divider" }
  | { type: "spacer"; height: number }
  | { type: "social"; links: Array<{ label: string; href: string }> };

export interface EmailDoc {
  blocks: EmailBlock[];
}

export const EMAIL_BLOCK_LABELS: Record<EmailBlock["type"], string> = {
  text: "Text",
  hero: "Hero image",
  columns: "Two columns",
  vehicle: "Vehicle card",
  button: "Button",
  divider: "Divider",
  spacer: "Spacer",
  social: "Social links",
};

export const EMAIL_CATEGORIES = ["Sales", "Service", "Marketing", "Transactional"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** The brand as an e-mail shows it. */
export interface EmailBrand {
  code: string;
  name: string;
  legalEntity: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  color: string;
  /** absolute https URL of the logo (served by the application), or null → the brand name as a word mark */
  logoUrl: string | null;
}

export interface EmailRenderOptions {
  brand: EmailBrand;
  merge: MergeData;
  /** sanitised HTML of the sender's signature for this brand */
  signatureHtml?: string | null;
  /** marketing e-mails: the recipient's per-brand unsubscribe link */
  unsubscribeUrl?: string | null;
  /** short text shown by mail clients next to the subject */
  preheader?: string | null;
}

const FONT = "Arial, Helvetica, sans-serif";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#1565d0");
const safeUrl = (u: string | undefined | null) => (u && /^(https?:\/\/|mailto:|tel:|cid:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u.trim()) ? u.trim() : "");

/** Inline styles for the tags the editor produces – mail clients ignore style sheets. */
function inlineStyles(html: string): string {
  return html
    .replace(/<p(?![^>]*\bstyle=)/gi, `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.5;color:${TEXT}"`)
    .replace(/<h1(?![^>]*\bstyle=)/gi, `<h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:1.3;color:#111827"`)
    .replace(/<h2(?![^>]*\bstyle=)/gi, `<h2 style="margin:0 0 10px;font-family:${FONT};font-size:20px;line-height:1.3;color:#111827"`)
    .replace(/<h3(?![^>]*\bstyle=)/gi, `<h3 style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.3;color:#111827"`)
    .replace(/<(ul|ol)(?![^>]*\bstyle=)/gi, `<$1 style="margin:0 0 12px;padding-left:22px;font-family:${FONT};font-size:15px;line-height:1.5;color:${TEXT}"`)
    .replace(/<a(?![^>]*\bstyle=)/gi, `<a style="color:#1565d0;text-decoration:underline"`)
    .replace(/<img(?![^>]*\bstyle=)/gi, `<img style="max-width:100%;height:auto;border:0"`)
    .replace(/<hr[^>]*>/gi, `<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">`)
    .replace(/<table(?![^>]*\bstyle=)/gi, `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 12px"`)
    .replace(/<(td|th)(?![^>]*\bstyle=)/gi, `<$1 style="border:1px solid #d1d5db;padding:6px 8px;font-family:${FONT};font-size:14px;color:${TEXT};vertical-align:top;text-align:left"`);
}

const button = (label: string, href: string, color: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 12px"><tr><td style="border-radius:4px;background-color:${color}"><a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:4px">${esc(label)}</a></td></tr></table>`;

function blockHtml(b: EmailBlock, o: EmailRenderOptions): string {
  const color = safeColor(o.brand.color);
  const m = (s: string) => renderMerge(s, o.merge);
  switch (b.type) {
    case "text":
      return inlineStyles(renderMergeHtml(b.html, o.merge));
    case "hero": {
      const src = safeUrl(b.url);
      if (!src) return "";
      const img = `<img src="${esc(src)}" alt="${esc(m(b.alt))}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:4px">`;
      const href = safeUrl(b.href);
      return `<div style="margin:0 0 14px">${href ? `<a href="${esc(href)}">${img}</a>` : img}</div>`;
    }
    case "columns":
      // two cells that stack on narrow screens (inline-block columns: no media queries needed)
      return `<div style="font-size:0;margin:0 0 6px">${[b.left, b.right]
        .map((html) => `<div style="display:inline-block;width:100%;max-width:268px;vertical-align:top;font-size:15px;margin:0 4px 8px">${inlineStyles(renderMergeHtml(html, o.merge))}</div>`)
        .join("")}</div>`;
    case "vehicle": {
      const src = safeUrl(b.image);
      const href = safeUrl(b.href);
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:6px;margin:0 0 14px"><tr><td style="padding:14px">
${src ? `<img src="${esc(src)}" alt="${esc(m(b.model))}" width="524" style="display:block;width:100%;max-width:524px;height:auto;border:0;border-radius:4px;margin:0 0 10px">` : ""}
<div style="font-family:${FONT};font-size:18px;font-weight:bold;color:#111827">${esc(m(b.model))}</div>
<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${color};margin:2px 0 6px">${esc(m(b.price))}</div>
${b.description ? `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${TEXT};margin:0 0 10px">${esc(m(b.description))}</div>` : ""}
${href ? button(m(b.cta) || "View", href, color) : ""}</td></tr></table>`;
    }
    case "button": {
      const href = safeUrl(m(b.href));
      return href ? button(m(b.label), href, color) : "";
    }
    case "divider":
      return `<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">`;
    case "spacer":
      return `<div style="height:${Math.min(80, Math.max(4, Math.round(b.height)))}px;line-height:1px;font-size:1px">&nbsp;</div>`;
    case "social": {
      const links = b.links.map((l) => ({ label: l.label, href: safeUrl(l.href) })).filter((l) => l.href);
      return links.length ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:14px;color:${MUTED}">${links.map((l) => `<a href="${esc(l.href)}" style="color:#1565d0;text-decoration:underline">${esc(l.label)}</a>`).join(" &nbsp;·&nbsp; ")}</p>` : "";
    }
  }
}

/** The complete e-mail: brand header, the blocks, the signature, the brand footer. */
export function renderEmailHtml(doc: EmailDoc, o: EmailRenderOptions): string {
  const color = safeColor(o.brand.color);
  const body = doc.blocks.map((b) => blockHtml(b, o)).join("\n");
  const signature = o.signatureHtml ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">${inlineStyles(o.signatureHtml)}</div>` : "";
  const header = o.brand.logoUrl ? `<img src="${esc(o.brand.logoUrl)}" alt="${esc(o.brand.name)}" height="40" style="display:block;height:40px;width:auto;max-width:240px;border:0">` : `<div style="font-family:${FONT};font-size:22px;font-weight:bold;color:${color}">${esc(o.brand.name)}</div>`;
  const footer = [esc(o.brand.legalEntity), o.brand.address ? esc(o.brand.address.replace(/\s*\r?\n\s*/g, ", ")) : null, o.brand.phone ? esc(o.brand.phone) : null, o.brand.website && safeUrl(/^https?:/i.test(o.brand.website) ? o.brand.website : `https://${o.brand.website}`) ? `<a href="${esc(/^https?:/i.test(o.brand.website) ? o.brand.website : `https://${o.brand.website}`)}" style="color:${MUTED};text-decoration:underline">${esc(o.brand.website)}</a>` : null].filter(Boolean).join(" · ");
  const unsubscribe = o.unsubscribeUrl ? `<br>You receive this because you agreed to hear from ${esc(o.brand.name)}. <a href="${esc(o.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title></title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6">${esc(o.preheader)}</div>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:6px" data-brand="${esc(o.brand.code)}">
<tr><td style="padding:18px 24px 14px">${header}</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:4px;background-color:${color}">&nbsp;</td></tr>
<tr><td style="padding:22px 24px 8px;font-family:${FONT};font-size:15px;line-height:1.5;color:${TEXT}">
${body}
${signature}
</td></tr>
<tr><td style="padding:14px 24px 20px;border-top:1px solid #e5e7eb;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED}">${footer}${unsubscribe}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const strip = (html: string) =>
  html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_x, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** The text part of the e-mail (also what is stored on the activity). */
export function renderEmailText(doc: EmailDoc, o: EmailRenderOptions): string {
  const m = (s: string) => renderMerge(s, o.merge);
  const parts = doc.blocks.map((b) => {
    switch (b.type) {
      case "text":
        return strip(renderMerge(b.html, o.merge));
      case "hero":
        return b.href ? `[${m(b.alt)}] ${b.href}` : `[${m(b.alt)}]`;
      case "columns":
        return `${strip(renderMerge(b.left, o.merge))}\n${strip(renderMerge(b.right, o.merge))}`;
      case "vehicle":
        return `${m(b.model)} – ${m(b.price)}${b.description ? `\n${m(b.description)}` : ""}${b.href ? `\n${m(b.cta) || "View"}: ${b.href}` : ""}`;
      case "button":
        return `${m(b.label)}: ${m(b.href)}`;
      case "social":
        return b.links.map((l) => `${l.label}: ${l.href}`).join("\n");
      default:
        return "";
    }
  });
  if (o.signatureHtml) parts.push(`--\n${strip(o.signatureHtml)}`);
  parts.push(`${o.brand.legalEntity}${o.brand.address ? `, ${o.brand.address.replace(/\s*\r?\n\s*/g, ", ")}` : ""}`);
  if (o.unsubscribeUrl) parts.push(`Unsubscribe: ${o.unsubscribeUrl}`);
  return parts
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** All author-written text of a document (for the merge-field and size checks). */
export function docSource(doc: EmailDoc): string {
  return doc.blocks
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.html;
        case "columns":
          return `${b.left} ${b.right}`;
        case "hero":
          return `${b.alt} ${b.href ?? ""}`;
        case "vehicle":
          return `${b.model} ${b.price} ${b.description ?? ""} ${b.cta} ${b.href}`;
        case "button":
          return `${b.label} ${b.href}`;
        default:
          return "";
      }
    })
    .join(" ");
}

/** A plain text as a one-block document (old plain-text templates, quick messages). */
export const textDoc = (text: string): EmailDoc => ({ blocks: [{ type: "text", html: text.split(/\r?\n\r?\n/).map((p) => `<p>${esc(p).replace(/\r?\n/g, "<br>")}</p>`).join("") }] });
