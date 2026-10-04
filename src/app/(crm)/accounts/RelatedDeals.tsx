import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { RelatedListCard } from "@/components/crm/record";
import { stageTone } from "@/components/crm/tones";
import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import { STAGE_LABELS } from "@/server/modules/deals/schema";

interface DealLine {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  closeDate: string | null;
  brandId: string;
  ownerName: string;
}

/**
 * Related deals of a customer. The list comes from the brand-scoped client, so it contains only deals the
 * viewer can access – and deliberately shows NO total or hint about deals of other brands.
 */
export function RelatedDeals({ deals, brands, dateFormat }: { deals: DealLine[]; brands: Array<{ id: string; code: string; color: string | null }>; dateFormat: DateFormat }) {
  return (
    <RelatedListCard id="deals" title="Deals" empty="No deals you can access.">
      {deals.length ? (
        <ul className="divide-y divide-border" data-testid="related-deals">
          {deals.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="related-deal">
              <BrandBadge brand={brands.find((b) => b.id === d.brandId)} />
              <Link href={`/deals/${d.id}`} className="flex-1 truncate font-medium text-primary hover:underline">
                {d.name}
              </Link>
              <StatusPill tone={stageTone(d.stage)}>{STAGE_LABELS[d.stage as keyof typeof STAGE_LABELS]}</StatusPill>
              <span className="w-32 text-right tabular-nums">{formatMoney(d.amount)}</span>
              <span className="w-24 text-right text-xs text-text-muted">{formatDate(d.closeDate, dateFormat)}</span>
              <span className="w-32 truncate text-xs text-text-muted">{d.ownerName}</span>
            </li>
          ))}
        </ul>
      ) : undefined}
    </RelatedListCard>
  );
}
