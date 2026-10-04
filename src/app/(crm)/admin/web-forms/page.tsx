import { headers } from "next/headers";
import { BrandBadge } from "@/components/BrandBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminLookups } from "@/server/modules/admin/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Web-to-Lead forms" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Embeddable form for a dealer website. Brand is fixed by the endpoint URL (never a form field). */
function snippet(origin: string, brandCode: string, regions: string[]): string {
  const endpoint = `${origin}/api/public/leads/${brandCode}`;
  return `<!-- StallionCRM web-to-lead form: ${brandCode} -->
<form id="stallion-lead-${brandCode}">
  <input name="firstName" placeholder="First name">
  <input name="lastName" placeholder="Last name" required>
  <input name="mobile" placeholder="Mobile" required>
  <input name="email" type="email" placeholder="Email">
  <input name="city" placeholder="City">
  <select name="region" required>
${regions.map((r) => `    <option>${esc(r)}</option>`).join("\n")}
  </select>
  <input name="model" placeholder="Model of interest">
  <textarea name="message" placeholder="Message"></textarea>
  <label><input type="checkbox" name="consentMarketing" value="true"> Keep me informed about offers</label>
  <!-- honeypot: leave hidden and empty -->
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">Send</button>
  <p data-status></p>
</form>
<script>
(function () {
  var form = document.getElementById("stallion-lead-${brandCode}");
  var params = new URLSearchParams(location.search);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"].forEach(function (k) {
      if (params.get(k)) data[k] = params.get(k);
    });
    data.referrer = document.referrer || location.href;
    fetch("${endpoint}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { form.querySelector("[data-status]").textContent = r.ok ? "Thank you – we will contact you shortly." : "Sorry, please try again."; if (r.ok) form.reset(); });
  });
})();
</script>`;
}

export default async function WebFormsPage() {
  const ctx = await requireContext();
  const lookups = await adminLookups(ctx);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const regions = lookups.activeRegions.map((r) => r.name);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Web-to-Lead forms</CardTitle>
          <CardDescription>
            One public endpoint per brand: <code>POST /api/public/leads/&lt;BRAND&gt;</code>. The brand comes from the URL only
            – a form for one brand can never create another brand&apos;s lead. Protected by a honeypot field, a per-IP rate
            limit and optional reCAPTCHA (set <code>RECAPTCHA_SECRET_KEY</code> and send <code>recaptchaToken</code>). UTM
            parameters and the referrer are captured. WhatsApp / Facebook use the same endpoint with
            <code>?channel=whatsapp|facebook</code> (adapters are stubs until configured). New leads go through the
            assignment rules.
          </CardDescription>
        </CardHeader>
      </Card>
      {lookups.pickableBrands.map((b) => (
        <Card key={b.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrandBadge brand={b} /> {b.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              readOnly
              className="h-56 w-full rounded-md border border-border bg-muted/40 p-2 font-mono text-xs"
              value={snippet(origin, b.code, regions)}
              aria-label={`Embed code for ${b.code}`}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
