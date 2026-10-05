import type { AccessContext } from "@/server/access/types";
import { letterheadHtml } from "@/server/modules/print/blocks";
import { screenLetterhead } from "@/server/modules/print/service";

/**
 * Letterhead that only appears on paper: put it on top of a page that is printed with the browser (reports,
 * dashboards). The brand is the one selected in the top-bar switcher (or the user's only brand); several brands →
 * the group letterhead for people who see every brand, otherwise the user's first brand.
 */
export async function PrintLetterhead({ ctx, title }: { ctx: AccessContext; title: string }) {
  const lh = await screenLetterhead(ctx);
  const color = /^#[0-9a-fA-F]{6}$/.test(lh.color) ? lh.color : "#1565d0";
  const css = `.print-only .lh{display:flex;justify-content:space-between;gap:8mm;padding-bottom:3mm;border-bottom:1.2mm solid ${color};margin-bottom:5mm}.print-only .lh-logo img{max-width:60mm;max-height:20mm}.print-only .lh-mark{font-size:20pt;font-weight:700;color:${color}}.print-only .lh-details{text-align:right;font-size:8.5pt}.print-only .lh-details strong{display:block;font-size:11pt}.print-only .printed{font-size:8pt;color:#4b5563;margin-bottom:4mm}`;
  const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return (
    <div className="print-only" data-testid="print-letterhead" data-letterhead={lh.code}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* letterheadHtml escapes every value it prints */}
      <div dangerouslySetInnerHTML={{ __html: letterheadHtml(lh) }} />
      <div className="printed">
        {title} · printed by {ctx.user.name} on {stamp}
      </div>
    </div>
  );
}
