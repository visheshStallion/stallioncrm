import "server-only";
import { hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { searchActivities } from "@/server/modules/activities/queries";
import { TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { searchCases } from "@/server/modules/cases/queries";
import { listAccounts, listContacts } from "@/server/modules/customers/queries";
import { searchDeals } from "@/server/modules/deals/queries";
import { scopedDb } from "@/server/db";
import { listProducts } from "@/server/modules/catalogue/queries";
import { DOCS, type DocType } from "@/server/modules/documents/config";
import { listUnits } from "@/server/modules/inventory/queries";
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
 * Global search (prompt 14): leads, deals, customers, cases, activities, quotes, sales orders, invoices,
 * products and vehicle stock – by name, phone, e-mail, VIN and document number. "Contains" matching, backed by
 * trigram indexes. Every searcher queries through scopedDb (and RLS), with the module's own masking, so a
 * result never includes a record or a field outside the user's scope – and there is no count of hidden results.
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
  // Documents by number, customer or the VIN on a line.
  for (const type of ["quote", "salesOrder", "invoice"] as DocType[]) {
    const cfg = DOCS[type];
    if (!hasPermission(ctx, cfg.module, "read")) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over the three document delegates
    const rows = await (scopedDb(ctx) as any)[type].findMany({
      where: { OR: [{ number: { contains: q, mode: "insensitive" } }, { lines: { some: { vin: { contains: q, mode: "insensitive" } } } }, { deal: { customerName: { contains: q, mode: "insensitive" } } }] },
      select: { id: true, number: true, status: true, brandId: true, regionId: true, deal: { select: { customerName: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    for (const d of rows) hits.push({ module: cfg.module, id: d.id, title: d.number, subtitle: [cfg.label, d.deal?.customerName, String(d.status).toLowerCase().replace(/_/g, " ")].filter(Boolean).join(" · "), brandId: d.brandId, regionId: d.regionId, href: `${cfg.path}/${d.id}` });
  }
  if (hasPermission(ctx, "products", "read")) {
    for (const p of (await listProducts(ctx, { q, take: 8 })).rows) hits.push({ module: "products", id: p.id, title: p.name, subtitle: p.code, brandId: p.brandId, regionId: null, href: `/products/${p.id}` });
  }
  // Vehicle stock by VIN: the inventory rules apply (own brands; sales users find available units by the last six characters only).
  if (hasPermission(ctx, "inventory", "read") && q.length >= 4) {
    for (const u of (await listUnits(ctx, { q }, { take: 8 })).rows) hits.push({ module: "inventory", id: u.id, title: u.vin, subtitle: [u.productName, u.statusLabel].join(" · "), brandId: u.brandId, regionId: null, href: `/inventory/units/${u.id}` });
  }
  return hits;
}
