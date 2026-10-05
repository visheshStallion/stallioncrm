/**
 * Provider adapters (prompt 10): one interface per channel, chosen by environment variables. Credentials live in
 * the environment / secret store – never in the repository or the database. Without configuration every
 * channel uses the SANDBOX adapter, which delivers nothing and keeps the messages in memory (development, tests).
 *
 *   EMAIL_PROVIDER    = sandbox | smtp | graph          SMTP_URL / GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   SMS_PROVIDER      = sandbox | termii | africastalking   TERMII_API_KEY / AT_USERNAME, AT_API_KEY
 *   WHATSAPP_PROVIDER = sandbox | cloud                  WHATSAPP_ACCESS_TOKEN
 */
import "server-only";

export type ChannelKey = "EMAIL" | "SMS" | "WHATSAPP";

export interface OutboundMessage {
  channel: ChannelKey;
  /** brand sender identity */
  from: { name?: string | null; address: string; whatsappPhoneId?: string | null };
  to: string;
  subject?: string | null;
  text: string;
  /** WhatsApp business-initiated messages: the approved template to use */
  whatsappTemplate?: { name: string; language?: string; parameters?: string[] } | null;
  /** List-Unsubscribe target (campaign email) */
  unsubscribeUrl?: string | null;
  // ── rich e-mail (prompt 20) ──
  /** complete HTML document; without it the text is sent as minimal HTML */
  html?: string | null;
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  /** `cid` = an image referenced from the HTML as cid:… (shown inline, not as a download) */
  attachments?: Array<{ filename: string; contentType: string; content: Uint8Array; cid?: string }>;
}

export interface ProviderResult {
  providerMessageId: string;
}

export interface Provider {
  name: string;
  send(message: OutboundMessage): Promise<ProviderResult>;
}

// ───────────────────────────── sandbox ─────────────────────────────

export interface SandboxEntry extends OutboundMessage {
  providerMessageId: string;
  at: Date;
}
const globalBox = globalThis as unknown as { __stallionSandboxOutbox?: SandboxEntry[] };
/** Messages "sent" through the sandbox adapters (newest last). */
export const sandboxOutbox: SandboxEntry[] = (globalBox.__stallionSandboxOutbox ??= []);
let sandboxFailure: ((m: OutboundMessage) => string | null) | null = null;
/** Tests: make the sandbox reject some messages (returns the error text) – null restores normal behaviour. */
export function setSandboxFailure(fn: ((m: OutboundMessage) => string | null) | null) {
  sandboxFailure = fn;
}

const sandbox: Provider = {
  name: "sandbox",
  async send(message) {
    const error = sandboxFailure?.(message);
    if (error) throw new Error(error);
    const providerMessageId = `sandbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sandboxOutbox.push({ ...message, providerMessageId, at: new Date() });
    if (sandboxOutbox.length > 2000) sandboxOutbox.splice(0, sandboxOutbox.length - 2000);
    return { providerMessageId };
  },
};

// ───────────────────────────── helpers ─────────────────────────────

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Plain text → minimal HTML (escaped, links clickable). */
export const textToHtml = (text: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>")}</div>`;
/** Header values must never contain line breaks (header injection). */
const headerSafe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`Provider answered ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, json };
}

// ───────────────────────────── email ─────────────────────────────

const smtp: Provider = {
  name: "smtp",
  async send(m) {
    const { createTransport } = await import("nodemailer");
    const transport = createTransport(need("SMTP_URL"));
    const info = await transport.sendMail({
      from: m.from.name ? { name: headerSafe(m.from.name), address: m.from.address } : m.from.address,
      to: m.to,
      subject: headerSafe(m.subject ?? ""),
      ...(m.cc?.length ? { cc: m.cc } : {}),
      ...(m.bcc?.length ? { bcc: m.bcc } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      text: m.text,
      html: m.html ?? textToHtml(m.text),
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: headerSafe(a.filename), contentType: a.contentType, content: Buffer.from(a.content), ...(a.cid ? { cid: a.cid, contentDisposition: "inline" as const } : {}) })) } : {}),
      ...(m.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>` } } : {}),
    });
    return { providerMessageId: info.messageId };
  },
};

let graphToken: { value: string; expires: number } | null = null;
/** Microsoft 365 (Graph, client-credentials flow). The app needs Mail.Send for the brand mailboxes. */
const graph: Provider = {
  name: "graph",
  async send(m) {
    if (!graphToken || graphToken.expires < Date.now() + 60_000) {
      const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(need("GRAPH_TENANT_ID"))}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: need("GRAPH_CLIENT_ID"), client_secret: need("GRAPH_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!res.ok || !json.access_token) throw new Error(`Microsoft 365 sign-in failed (${res.status})`);
      graphToken = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3000) * 1000 };
    }
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m.from.address)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${graphToken.value}` },
      body: JSON.stringify({
        message: {
          subject: headerSafe(m.subject ?? ""),
          body: { contentType: "HTML", content: m.html ?? textToHtml(m.text) },
          toRecipients: [{ emailAddress: { address: m.to } }],
          ...(m.cc?.length ? { ccRecipients: m.cc.map((address) => ({ emailAddress: { address } })) } : {}),
          ...(m.bcc?.length ? { bccRecipients: m.bcc.map((address) => ({ emailAddress: { address } })) } : {}),
          ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}),
          ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: headerSafe(a.filename), contentType: a.contentType, contentBytes: Buffer.from(a.content).toString("base64"), ...(a.cid ? { isInline: true, contentId: a.cid } : {}) })) } : {}),
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Microsoft 365 answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { providerMessageId: res.headers.get("request-id") ?? `graph-${Date.now()}` };
  },
};

// ───────────────────────────── SMS ─────────────────────────────

const termii: Provider = {
  name: "termii",
  async send(m) {
    const { json } = await postJson(`${process.env.TERMII_BASE_URL ?? "https://api.ng.termii.com"}/api/sms/send`, {
      api_key: need("TERMII_API_KEY"),
      to: m.to.replace(/^\+/, ""),
      from: m.from.address,
      sms: m.text,
      type: "plain",
      channel: process.env.TERMII_CHANNEL ?? "generic",
    });
    return { providerMessageId: String(json.message_id ?? `termii-${Date.now()}`) };
  },
};

const africasTalking: Provider = {
  name: "africastalking",
  async send(m) {
    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", apiKey: need("AT_API_KEY") },
      body: new URLSearchParams({ username: need("AT_USERNAME"), to: m.to, message: m.text, from: m.from.address }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: Array<{ messageId?: string; status?: string }> } };
    const recipient = json.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !recipient?.messageId || recipient.messageId === "None") throw new Error(`Africa's Talking: ${recipient?.status ?? res.status}`);
    return { providerMessageId: recipient.messageId };
  },
};

// ───────────────────────────── WhatsApp ─────────────────────────────

const whatsappCloud: Provider = {
  name: "cloud",
  async send(m) {
    if (!m.from.whatsappPhoneId) throw new Error("The brand has no WhatsApp phone-number id");
    const payload = m.whatsappTemplate
      ? {
          type: "template",
          template: {
            name: m.whatsappTemplate.name,
            language: { code: m.whatsappTemplate.language ?? "en" },
            ...(m.whatsappTemplate.parameters?.length ? { components: [{ type: "body", parameters: m.whatsappTemplate.parameters.map((text) => ({ type: "text", text })) }] } : {}),
          },
        }
      : { type: "text", text: { body: m.text } };
    const { json } = await postJson(
      `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}/${encodeURIComponent(m.from.whatsappPhoneId)}/messages`,
      { messaging_product: "whatsapp", to: m.to.replace(/^\+/, ""), ...payload },
      { Authorization: `Bearer ${need("WHATSAPP_ACCESS_TOKEN")}` },
    );
    const id = (json.messages as Array<{ id?: string }> | undefined)?.[0]?.id;
    return { providerMessageId: id ?? `wa-${Date.now()}` };
  },
};

const REGISTRY: Record<ChannelKey, { env: string; providers: Record<string, Provider> }> = {
  EMAIL: { env: "EMAIL_PROVIDER", providers: { smtp, graph } },
  SMS: { env: "SMS_PROVIDER", providers: { termii, africastalking: africasTalking } },
  WHATSAPP: { env: "WHATSAPP_PROVIDER", providers: { cloud: whatsappCloud } },
};

/** The configured adapter of a channel (sandbox when nothing – or something unknown – is configured). */
export function providerFor(channel: ChannelKey): Provider {
  const { env, providers } = REGISTRY[channel];
  return providers[(process.env[env] ?? "").toLowerCase()] ?? sandbox;
}
