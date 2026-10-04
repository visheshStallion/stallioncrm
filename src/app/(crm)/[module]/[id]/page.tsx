import { forbidden, notFound } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { RecordForm } from "@/components/RecordForm";
import { RegionBadge } from "@/components/RegionBadge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { isModuleKey } from "@/server/access/modules";
import { getDeal } from "@/server/modules/deals/queries";
import { STAGE_LABELS } from "@/server/modules/deals/schema";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export default async function RecordPage({ params }: { params: Promise<{ module: string; id: string }> }) {
  const { module, id } = await params;
  if (!isModuleKey(module) || module !== "deals") notFound();
  const ctx = await requireContext();
  if (!hasPermission(ctx, module, "read")) forbidden();

  // Out-of-scope and missing records both render 404 – existence is never revealed.
  const deal = await getDeal(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const dir = await getDirectory(ctx);
  const brand = dir.brands.find((b) => b.id === deal.brandId);
  const region = dir.regions.find((r) => r.id === deal.regionId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" data-testid="record-header">
        <BrandBadge brand={brand} size="lg" />
        <h1 className="text-2xl font-semibold">{deal.name}</h1>
        <RegionBadge region={region} />
      </div>
      <Card>
        <CardContent className="pt-5">
          <RecordForm
            readOnly
            fields={[
              { name: "customerName", label: "Customer", value: deal.customerName },
              { name: "stage", label: "Stage", value: STAGE_LABELS[deal.stage as keyof typeof STAGE_LABELS] },
              { name: "amount", label: "Amount", value: formatMoney(deal.amount) },
              { name: "closeDate", label: "Close date", value: formatDate(deal.closeDate) },
              { name: "brand", label: "Brand", display: <BrandBadge brand={brand} /> },
              { name: "region", label: "Region", display: <RegionBadge region={region} /> },
              { name: "territory", label: "Territory", value: deal.territoryName },
              { name: "owner", label: "Owner", value: deal.ownerName },
              { name: "updatedAt", label: "Last updated", value: formatDate(deal.updatedAt) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
