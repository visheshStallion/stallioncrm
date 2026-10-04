import { forbidden, notFound } from "next/navigation";
import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { Kanban } from "@/components/Kanban";
import { RegionBadge } from "@/components/RegionBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { getModule, isModuleKey } from "@/server/access/modules";
import { listDeals } from "@/server/modules/deals/queries";
import { DEAL_STAGES, STAGE_LABELS } from "@/server/modules/deals/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";
import { DealsTable } from "./DealsTable";

export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { module } = await params;
  if (!isModuleKey(module)) notFound();
  const ctx = await requireContext();
  if (!hasPermission(ctx, module, "read")) forbidden();
  const def = getModule(module)!;

  if (module !== "deals") {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{def.label}</CardTitle>
          <CardDescription>This module is built in prompt {def.prompt}.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { view } = await searchParams;
  const [dir, filters] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const { rows, total } = await listDeals(ctx, filters);
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  const region = (id: string) => dir.regions.find((r) => r.id === id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deals</h1>
          <p className="text-sm text-muted-foreground" data-testid="deal-total">
            {total} deal(s) in your scope
          </p>
        </div>
        <div className="flex gap-1">
          <Button asChild size="sm" variant={view === "kanban" ? "outline" : "default"}>
            <Link href="/deals">List</Link>
          </Button>
          <Button asChild size="sm" variant={view === "kanban" ? "default" : "outline"}>
            <Link href="/deals?view=kanban">Kanban</Link>
          </Button>
        </div>
      </div>

      {view === "kanban" ? (
        <Kanban
          columns={DEAL_STAGES.map((stage) => ({
            key: stage,
            label: STAGE_LABELS[stage],
            cards: rows
              .filter((r) => r.stage === stage)
              .map((r) => ({
                id: r.id,
                title: r.name,
                subtitle: r.ownerName,
                href: `/deals/${r.id}`,
                badges: (
                  <>
                    <BrandBadge brand={brand(r.brandId)} />
                    <RegionBadge region={region(r.regionId)} />
                  </>
                ),
                footer: formatMoney(r.amount),
              })),
          }))}
        />
      ) : (
        <Card>
          <CardContent className="pt-5">
            <DealsTable rows={rows} brands={dir.brands} regions={dir.regions} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
