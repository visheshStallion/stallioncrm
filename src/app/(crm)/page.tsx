import { BrandBadge } from "@/components/BrandBadge";
import { RegionBadge } from "@/components/RegionBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  const db = scopedDb(ctx);
  const [territories, dealsByBrand] = await Promise.all([
    db.territory.findMany({
      where: { id: { in: ctx.memberships.map((m) => m.territoryId) } },
      select: { id: true, name: true, brandId: true, regionId: true },
      orderBy: { name: "asc" },
    }),
    hasPermission(ctx, "deals", "read")
      ? db.deal.groupBy({ by: ["brandId"], _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const brand = (id: string | null) => dir.brands.find((b) => b.id === id);
  const region = (id: string | null) => dir.regions.find((r) => r.id === id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {ctx.user.name}</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.user.roleName} · {ctx.profile.name} profile ·{" "}
          {ctx.scope === "ALL" ? "sees all brands and regions" : "sees records in the territories below"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your territories</CardTitle>
            <CardDescription>Visibility = owner, or a territory membership (brand × region).</CardDescription>
          </CardHeader>
          <CardContent>
            {ctx.scope === "ALL" ? (
              <p className="text-sm">Group – All Brands (scope ALL)</p>
            ) : territories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No territory memberships – you only see records you own.</p>
            ) : (
              <ul className="space-y-1.5" data-testid="territory-list">
                {territories.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <BrandBadge brand={brand(t.brandId)} />
                    {t.regionId ? <RegionBadge region={region(t.regionId)} /> : <span className="text-xs">all regions</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deals you can see</CardTitle>
            <CardDescription>Counted through the brand-scoped client.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5" data-testid="deal-counts">
              {dealsByBrand.map((g) => (
                <li key={g.brandId} className="flex items-center justify-between text-sm">
                  <BrandBadge brand={brand(g.brandId)} />
                  <span className="font-medium">{g._count._all}</span>
                </li>
              ))}
              {dealsByBrand.length === 0 ? <li className="text-sm text-muted-foreground">None</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
