import "server-only";
import { hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { searchActivities } from "@/server/modules/activities/queries";
import { TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { searchCases } from "@/server/modules/cases/queries";
import { listAccounts, listContacts } from "@/server/modules/customers/queries";
import { searchDeals } from "@/server/modules/deals/queries";
import { leadName, searchLeads } from "@/server/modules/leads/queries";

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
  if (hasPermission(ctx, "leads", "read")) {
    for (const l of await searchLeads(ctx, q)) {
      hits.push({
        module: "leads",
        id: l.id,
        title: leadName(l),
        subtitle: [l.city, l.status].filter(Boolean).join(" · "),
        brandId: l.brandId,
        regionId: l.regionId,
        href: `/leads/${l.id}`,
      });
    }
  }
  if (hasPermission(ctx, "deals", "read")) {
    for (const d of await searchDeals(ctx, q)) {
      hits.push({
        module: "deals",
        id: d.id,
        title: d.name,
        subtitle: [d.customerName, d.stageName].filter(Boolean).join(" · "),
        brandId: d.brandId,
        regionId: d.regionId,
        href: `/deals/${d.id}`,
      });
    }
  }
  // Shared customers: found by name or full phone; shown masked per the viewer's field tier.
  if (hasPermission(ctx, "accounts", "read")) {
    for (const acc of (await listAccounts(ctx, { q, take: 10 })).rows) {
      hits.push({ module: "accounts", id: acc.id, title: acc.name, subtitle: [acc.city, acc.phone].filter(Boolean).join(" · "), brandId: null, regionId: null, href: `/accounts/${acc.id}` });
    }
  }
  if (hasPermission(ctx, "contacts", "read")) {
    for (const c of (await listContacts(ctx, { q, take: 10 })).rows) {
      hits.push({ module: "contacts", id: c.id, title: c.name, subtitle: [c.accountName, c.mobile].filter(Boolean).join(" · "), brandId: null, regionId: null, href: `/contacts/${c.id}` });
    }
  }
  if (hasPermission(ctx, "cases", "read")) {
    for (const c of await searchCases(ctx, q)) {
      hits.push({ module: "cases", id: c.id, title: `${c.number} – ${c.subject}`, subtitle: c.status.toLowerCase().replace(/_/g, " "), brandId: c.brandId, regionId: c.regionId, href: `/cases/${c.id}` });
    }
  }
  if (hasPermission(ctx, "activities", "read")) {
    for (const a of await searchActivities(ctx, q)) {
      hits.push({ module: "activities", id: a.id, title: a.subject, subtitle: [TYPE_LABELS[a.type as ActivityTypeKey], a.status.toLowerCase()].join(" · "), brandId: a.brandId, regionId: a.regionId, href: `/activities/${a.id}` });
    }
  }
  return hits;
}
