/**
 * HTML sanitiser for everything a user can author: rich-text blocks of print templates, e-mail bodies, e-mail
 * templates and signatures. Allow-list based (sanitize-html): no scripts, iframes, forms, event handlers or
 * `javascript:` links; styles limited to a few harmless properties; images only from our own storage, data: URIs or
 * https. Merge fields ({{…}}) are plain text and pass through untouched.
 */
import sanitizeHtml from "sanitize-html";

const COLOR = [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/, /^[a-z]{3,20}$/i];
const SIZE = [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%|mm)$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "h1", "h2", "h3", "h4", "ul", "ol", "li", "a", "span", "div", "blockquote", "hr", "img", "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col", "mark", "sub", "sup", "code", "pre"],
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "style", "data-button"],
    img: ["src", "alt", "width", "height", "style"],
    td: ["colspan", "rowspan", "style", "align", "valign"],
    th: ["colspan", "rowspan", "style", "align", "valign"],
    table: ["style", "width", "cellpadding", "cellspacing", "border", "align", "role"],
    col: ["style", "width"],
    "*": ["style"],
  },
  allowedSchemes: ["https", "http", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https", "data", "cid"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedStyles: {
    "*": {
      color: COLOR,
      "background-color": COLOR,
      "text-align": [/^(left|right|center|justify)$/],
      "font-size": SIZE,
      "font-weight": [/^(bold|normal|[1-9]00)$/],
      "font-style": [/^(italic|normal)$/],
      "text-decoration": [/^(underline|line-through|none)$/],
      "line-height": [/^\d+(?:\.\d+)?$/, ...SIZE],
      width: SIZE,
      "max-width": SIZE,
      height: SIZE,
      padding: [/^(\d+(?:\.\d+)?(?:px|pt|mm)\s*){1,4}$/],
      margin: [/^((\d+(?:\.\d+)?(?:px|pt|mm)|0|auto)\s*){1,4}$/],
      border: [/^\d+(?:px|pt)\s+(solid|dashed|dotted)\s+#[0-9a-f]{3,6}$/i],
      "border-radius": SIZE,
      "border-collapse": [/^(collapse|separate)$/],
      "vertical-align": [/^(top|middle|bottom|baseline)$/],
      display: [/^(block|inline-block|inline)$/],
    },
  },
  transformTags: {
    // links opened from an e-mail or a printout never get the opener
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }),
    b: "strong",
    i: "em",
    strike: "s",
  },
  // images embedded as data: URIs are limited to raster formats (an SVG could carry script)
  exclusiveFilter: (frame) => frame.tag === "img" && /^data:/i.test(frame.attribs.src ?? "") && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(frame.attribs.src ?? ""),
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
};

export const MAX_HTML = 200_000;

/** Sanitised HTML (may be an empty string). Input longer than 200 KB is refused by the callers before this. */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** Plain-text version of an HTML fragment (the text part of an e-mail, activity descriptions, previews). */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    });
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Images of the fragment that have no alternative text (lint for e-mail templates). */
export function imagesWithoutAlt(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt="[^"]+"/i.test(m[0])) n++;
  return n;
}
