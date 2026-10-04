import "server-only";
import { hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { searchDeals } from "@/server/modules/deals/queries";

export interface SearchHit {
  module: string;
  id: string;
  title: string;
  subtitle: string | null;
  brandId: string | null;
  regionId: string | null;
  href: string;
}

/**
 * Global search (stub). Every searcher queries through scopedDb, so results never include records
 * outside the user's scope. Later modules add their searcher here.
 */
export async function globalSearch(ctx: AccessContext, rawQuery: string): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  if (hasPermission(ctx, "deals", "read")) {
    for (const d of await searchDeals(ctx, q)) {
      hits.push({
        module: "deals",
        id: d.id,
        title: d.name,
        subtitle: d.customerName,
        brandId: d.brandId,
        regionId: d.regionId,
        href: `/deals/${d.id}`,
      });
    }
  }
  return hits;
}
