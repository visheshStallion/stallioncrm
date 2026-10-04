/**
 * Error tracking (prompt 15): unexpected server errors go to a Sentry-compatible endpoint when SENTRY_DSN is
 * set (Sentry, GlitchTip, …). No SDK: one envelope per error over HTTPS. Only the error (type, message, stack)
 * and where it happened are sent – never request bodies, headers, cookies or user data.
 */
import "server-only";

interface Dsn {
  url: string;
  key: string;
}

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "");
    if (!u.username || !project) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

/** Stack frames in Sentry's format (innermost last). */
function frames(stack: string | undefined) {
  return (stack ?? "")
    .split("\n")
    .slice(1, 40)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ function: m[1] ?? "<anonymous>", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }))
    .reverse();
}

export function buildEnvelope(err: unknown, where: Record<string, string | undefined>, dsn: string, now = new Date()): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = globalThis.crypto.randomUUID().replace(/-/g, ""); // Web Crypto: this module is also bundled for the edge runtime
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.APP_RELEASE,
    tags: Object.fromEntries(Object.entries(where).filter(([, v]) => v)),
    exception: { values: [{ type: e.name, value: e.message.slice(0, 500), stacktrace: { frames: frames(e.stack) } }] },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

/** Fire and forget: tracking must never slow down or break the request. */
export function captureException(err: unknown, where: Record<string, string | undefined> = {}): void {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  void fetch(dsn.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=stallioncrm/1.0` },
    body: buildEnvelope(err, where, process.env.SENTRY_DSN!),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}
