"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { RememberListIds } from "@/components/crm/KeyboardShortcuts";
import { Avatar, EmptyState, StatusPill } from "@/components/crm/primitives";
import { stageTone } from "@/components/crm/tones";
import { DataTable } from "@/components/DataTable";
import { Kanban, rejectMove } from "@/components/Kanban";
import { RegionBadge } from "@/components/RegionBadge";
import { toast } from "@/components/Toaster";
import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import { updateDealAction } from "@/server/modules/deals/actions";
import type { DealRow } from "@/server/modules/deals/queries";
import { DEAL_STAGES, STAGE_LABELS } from "@/server/modules/deals/schema";
import type { BrandInfo, RegionInfo } from "@/server/modules/org/queries";
import type { ColumnLayout } from "@/server/modules/preferences/schema";


const STALE_MS = 7 * 86_400_000;

export function DealsView({
  layout,
  rows,
  brands,
  regions,
  canEdit,
  dateFormat,
  columnLayout,
}: {
  layout: "list" | "kanban";
  rows: DealRow[];
  brands: BrandInfo[];
  regions: RegionInfo[];
  canEdit: boolean;
  dateFormat: DateFormat;
  columnLayout: ColumnLayout | null;
}) {
  const router = useRouter();
  const brand = (id: string) => brands.find((b) => b.id === id);
  const region = (id: string) => regions.find((r) => r.id === id);

  if (layout === "kanban") {
    return (
      <Kanban
        columns={DEAL_STAGES.map((s) => ({
          key: s,
          label: STAGE_LABELS[s],
          cards: rows
            .filter((r) => r.stage === s)
            .map((r) => ({
              id: r.id,
              title: r.name,
              subtitle: r.customerName,
              href: `/deals/${r.id}`,
              amount: r.amount,
              date: formatDate(r.closeDate, dateFormat),
              ownerName: r.ownerName,
              brand: brand(r.brandId),
              stale: !["CLOSED_WON", "CLOSED_LOST"].includes(r.stage) && Date.now() - Date.parse(r.updatedAt) > STALE_MS,
              badges: <BrandBadge brand={brand(r.brandId)} />,
            })),
        }))}
        onMove={
          canEdit
            ? async (id, stage) => {
                // The Blueprint (prompt 04) will validate transitions and mandatory fields here.
                const res = await updateDealAction(id, { stage: stage as (typeof DEAL_STAGES)[number] });
                if (!res.ok) return rejectMove(res.error.message);
                toast(`Moved to ${STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}`, "success");
                return true;
              }
            : undefined
        }
      />
    );
  }

  const columns: ColumnDef<DealRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Deal Name",
      cell: ({ row }) => (
        <Link href={`/deals/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { id: "brand", header: "Brand", accessorFn: (r) => brand(r.brandId)?.code ?? "", cell: ({ row }) => <BrandBadge brand={brand(row.original.brandId)} /> },
    { accessorKey: "customerName", header: "Customer" },
    { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount)}</span> },
    {
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => <StatusPill tone={stageTone(row.original.stage)}>{STAGE_LABELS[row.original.stage as keyof typeof STAGE_LABELS]}</StatusPill>,
    },
    { accessorKey: "closeDate", header: "Closing Date", cell: ({ row }) => formatDate(row.original.closeDate, dateFormat) },
    { id: "region", header: "Region", accessorFn: (r) => region(r.regionId)?.name ?? "", cell: ({ row }) => <RegionBadge region={region(row.original.regionId)} /> },
    {
      accessorKey: "ownerName",
      header: "Owner",
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <Avatar name={row.original.ownerName} size={20} />
          {row.original.ownerName}
        </span>
      ),
    },
  ];

  return (
    <>
      <RememberListIds module="deals" ids={rows.map((r) => r.id)} />
      <DataTable
        module="deals"
        layout={columnLayout}
        columns={columns}
        data={rows}
        emptyState={<EmptyState title="No deals in this view" text="Try another view or clear the filters." />}
        rowActions={(r) => (
          <Link href={`/deals/${r.id}`} className="rounded p-1 hover:bg-surface" aria-label={`Open ${r.name}`} onClick={() => router.prefetch(`/deals/${r.id}`)}>
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        )}
      />
    </>
  );
}
