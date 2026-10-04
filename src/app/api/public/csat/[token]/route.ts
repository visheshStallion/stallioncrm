import { caseBySurveyToken, recordSurvey } from "@/server/db/cases-system";
import { rateLimit } from "@/server/rate-limit";

/**
 * Customer satisfaction survey of a closed case (link sent with the closing message).
 *   GET  shows the 1–5 form, POST stores the answer once. The token is the only credential; unknown tokens get
 *   a neutral page. Nothing about the case except its number and brand is shown.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f6f8;color:#1f2933;margin:0}main{max-width:480px;margin:10vh auto;background:#fff;border:1px solid #d9dee4;border-radius:8px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}fieldset{border:0;padding:0;margin:16px 0;display:flex;gap:8px}label{flex:1;text-align:center;border:1px solid #c5ccd6;border-radius:6px;padding:10px 0;cursor:pointer}textarea{width:100%;box-sizing:border-box;min-height:80px;border:1px solid #c5ccd6;border-radius:6px;padding:8px;font:inherit}button{background:#1565D0;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer;margin-top:12px}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
const limited = (req: Request) => !rateLimit(`csat:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`, 30, 10 * 60 * 1000).ok;
const neutral = () => page("Survey", "<p>This survey link is no longer valid.</p>", 404);

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (limited(req)) return page("Too many requests", "<p>Please try again later.</p>", 429);
  const c = await caseBySurveyToken((await params).token);
  if (!c) return neutral();
  if (c.satisfactionScore !== null) return page("Thank you", `<p>We already have your feedback on case ${esc(c.number)}.</p>`);
  const options = [1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="score" value="${n}" required> ${n}</label>`).join("");
  return page(
    `How did ${c.brand.name} do?`,
    `<p>Case <strong>${esc(c.number)}</strong> has been closed. How satisfied are you with how it was handled? (1 = not at all, 5 = very satisfied)</p>
<form method="post"><fieldset aria-label="Satisfaction from 1 to 5">${options}</fieldset><label style="border:0;text-align:left;padding:0" for="note">Anything we should know? (optional)</label><textarea id="note" name="note" maxlength="1000"></textarea><button type="submit">Send feedback</button></form>`,
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (limited(req)) return page("Too many requests", "<p>Please try again later.</p>", 429);
  const form = await req.formData().catch(() => null);
  const score = Number(form?.get("score"));
  if (!Number.isInteger(score) || score < 1 || score > 5) return page("Survey", "<p>Please choose a score from 1 to 5.</p>", 400);
  const res = await recordSurvey((await params).token, score, (form?.get("note") ?? "").toString().trim() || null);
  if (!res) return neutral();
  return page("Thank you", `<p>${res.already ? "We already have your feedback" : "Your feedback has been recorded"} for case ${esc(res.number)}. Thank you for choosing ${esc(res.brandName)}.</p>`);
}
