import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { Pagination } from "@/components/crm/ListPage";
import { EmptyState, PageTitleRow } from "@/components/crm/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { parsePaging } from "@/server/list/filters";
import { canSeeCost, listJournals } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Inventory journals" };

/** Journals of the inventory postings, per brand (legal entity). Inventory finance only. Immutable. */
export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ page?: string; per?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canSeeCost(ctx)) forbidden();
  const [ui, dir, prefs] = await Promise.all([getUiFilters(ctx), getDirectory(ctx), getPreferences(ctx)]);
  const paging = parsePaging({ page: sp.page, per: sp.per ?? "50" });
  const { rows, total } = await listJournals(ctx, { brandId: ui.brandId }, { take: paging.per, skip: paging.skip });
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  return (
    <div>
      <PageTitleRow title="Inventory journals" left={<span className="text-[13px] text-text-muted">{total} entries · posted entries cannot be changed</span>} />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="No journals yet" />
        </div>
      ) : (
        <div className="space-y-2" data-testid="journals">
          {rows.map((j) => (
            <section key={j.id} className="rounded-lg border border-border bg-surface p-3 text-[13px]">
              <header className="mb-1 flex flex-wrap items-center gap-2">
                {brand(j.brandId) ? <BrandBadge brand={brand(j.brandId)!} /> : null}
                <span className="font-semibold">{j.number}</span>
                <span className="text-text-muted">{formatDate(j.date, prefs.dateFormat)}</span>
                <span>{j.sourceDocId && j.sourceDocType !== "INVOICE" && j.sourceDocType !== "SEED" ? <Link href={`/inventory/documents/${j.sourceDocId}`} className="text-primary hover:underline">{j.memo}</Link> : j.memo}</span>
                {j.exportedAt ? <span className="ml-auto text-xs text-text-muted">sent to ERP</span> : null}
              </header>
              <table className="w-full">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1">{l.account}</td>
                      <td className="w-44 text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</td>
                      <td className="w-44 text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      <Pagination total={total} page={paging.page} per={paging.per} />
    </div>
  );
}
