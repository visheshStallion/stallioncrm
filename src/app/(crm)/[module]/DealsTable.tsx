"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { DataTable } from "@/components/DataTable";
import { RegionBadge } from "@/components/RegionBadge";
import { formatDate, formatMoney } from "@/lib/format";
import type { DealRow } from "@/server/modules/deals/queries";
import { STAGE_LABELS } from "@/server/modules/deals/schema";
import type { BrandInfo, RegionInfo } from "@/server/modules/org/queries";

export function DealsTable({
  rows,
  brands,
  regions,
}: {
  rows: DealRow[];
  brands: BrandInfo[];
  regions: RegionInfo[];
}) {
  const brand = (id: string) => brands.find((b) => b.id === id);
  const region = (id: string) => regions.find((r) => r.id === id);

  const columns: ColumnDef<DealRow, unknown>[] = [
    {
      id: "brand",
      header: "Brand",
      accessorFn: (r) => brand(r.brandId)?.code ?? "",
      cell: ({ row }) => <BrandBadge brand={brand(row.original.brandId)} />,
    },
    {
      accessorKey: "name",
      header: "Deal",
      cell: ({ row }) => (
        <Link href={`/deals/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "customerName", header: "Customer" },
    {
      id: "region",
      header: "Region",
      accessorFn: (r) => region(r.regionId)?.name ?? "",
      cell: ({ row }) => <RegionBadge region={region(row.original.regionId)} />,
    },
    {
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => STAGE_LABELS[row.original.stage as keyof typeof STAGE_LABELS] ?? row.original.stage,
    },
    { accessorKey: "amount", header: "Amount", cell: ({ row }) => formatMoney(row.original.amount) },
    { accessorKey: "ownerName", header: "Owner" },
    { accessorKey: "closeDate", header: "Close date", cell: ({ row }) => formatDate(row.original.closeDate) },
  ];

  return <DataTable columns={columns} data={rows} emptyMessage="No deals in your scope." filterPlaceholder="Filter deals…" />;
}
