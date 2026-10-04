import { memberByToken, unsubscribeByToken } from "@/server/db/messaging-system";
import { rateLimit } from "@/server/rate-limit";

/**
 * Unsubscribe link of campaign messages – per brand.
 *   GET  shows a confirmation page (so that link scanners / previews do not unsubscribe anyone),
 *   POST opts the recipient out of THIS brand's marketing (also used by one-click List-Unsubscribe-Post).
 * Other brands' consent is not touched. Unknown tokens get the same neutral page.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f6f8;color:#1f2933;margin:0}main{max-width:460px;margin:12vh auto;background:#fff;border:1px solid #d9dee4;border-radius:8px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}button{background:#1565D0;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );

const limited = (req: Request) => !rateLimit(`unsubscribe:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`, 30, 10 * 60 * 1000).ok;
const neutral = () => page("Unsubscribe", "<p>This link is no longer valid. If you keep receiving messages, reply STOP or contact the dealership.</p>", 404);

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (limited(req)) return page("Too many requests", "<p>Please try again later.</p>", 429);
  const m = await memberByToken((await params).token);
  if (!m) return neutral();
  const brand = esc(m.campaign.brand.name);
  if (m.status === "UNSUBSCRIBED") return page("You are unsubscribed", `<p>You will not receive marketing messages from <strong>${brand}</strong> any more.</p>`);
  return page(`Unsubscribe from ${m.campaign.brand.name}`, `<p>Stop marketing messages from <strong>${brand}</strong>? Messages about your own orders are not affected.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (limited(req)) return page("Too many requests", "<p>Please try again later.</p>", 429);
  const done = await unsubscribeByToken((await params).token);
  if (!done) return neutral();
  return page("You are unsubscribed", `<p>You will not receive marketing messages from <strong>${esc(done.brandName)}</strong> any more.</p>`);
}
