"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { RememberListIds } from "@/components/crm/KeyboardShortcuts";
import { Avatar, EmptyState, StatusPill } from "@/components/crm/primitives";
import { stageTone } from "@/components/crm/tones";
import { DataTable } from "@/components/DataTable";
import { Kanban } from "@/components/Kanban";
import { RegionBadge } from "@/components/RegionBadge";
import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import type { DealRow, PipelineInfo } from "@/server/modules/deals/queries";
import type { BrandInfo, RegionInfo } from "@/server/modules/org/queries";
import type { ColumnLayout } from "@/server/modules/preferences/schema";
import { useBlueprint } from "./Blueprint";

export function DealsView({
  layout,
  rows,
  brands,
  regions,
  pipelines,
  products,
  canEdit,
  dateFormat,
  columnLayout,
}: {
  layout: "list" | "kanban";
  rows: DealRow[];
  brands: BrandInfo[];
  regions: RegionInfo[];
  /** Pipelines to render as boards (one selected pipeline, or one per brand for "All my brands"). */
  pipelines: PipelineInfo[];
  products: Array<{ id: string; name: string; brandId: string }>;
  canEdit: boolean;
  dateFormat: DateFormat;
  columnLayout: ColumnLayout | null;
}) {
  const brand = (id: string) => brands.find((b) => b.id === id);
  const region = (id: string) => regions.find((r) => r.id === id);
  const { move, dialog } = useBlueprint(products);

  if (layout === "kanban") {
    return (
      <div className="space-y-5">
        {pipelines.map((p) => {
          const deals = rows.filter((r) => r.pipelineId === p.id);
          return (
            <section key={p.id} data-testid="pipeline-board" data-brand={brand(p.brandId)?.code}>
              {pipelines.length > 1 ? (
                <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                  <BrandBadge brand={brand(p.brandId)} /> {p.name}
                  <span className="font-normal text-text-muted">· {deals.length} deal(s)</span>
                </h2>
              ) : null}
              <Kanban
                columns={p.stages.map((s) => ({
                  key: s.id,
                  label: s.name,
                  cards: deals
                    .filter((r) => r.stageId === s.id)
                    .map((r) => ({
                      id: r.id,
                      title: r.name,
                      subtitle: r.customerName,
                      href: `/deals/${r.id}`,
                      amount: r.amount,
                      date: formatDate(r.closeDate, dateFormat),
                      ownerName: r.ownerName,
                      brand: brand(r.brandId),
                      stale: r.stale,
                      badges: <BrandBadge brand={brand(r.brandId)} />,
                    })),
                }))}
                onMove={
                  canEdit
                    ? (id, stageId) => {
                        const deal = rows.find((r) => r.id === id);
                        const stage = p.stages.find((s) => s.id === stageId);
                        // A card can only be dropped on a stage of its own pipeline.
                        if (!deal || !stage || deal.pipelineId !== p.id) return Promise.resolve(false);
                        return move(deal, stage);
                      }
                    : undefined
                }
              />
            </section>
          );
        })}
        {pipelines.length === 0 ? <EmptyState title="No pipeline available" /> : null}
        {dialog}
      </div>
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
      id: "stage",
      header: "Stage",
      accessorFn: (r) => r.stageName,
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <StatusPill tone={stageTone(row.original.stageType)}>{row.original.stageName}</StatusPill>
          {row.original.stale ? (
            <StatusPill tone="warning">
              <span title={`${row.original.daysInStage} days in this stage`}>Stale</span>
            </StatusPill>
          ) : null}
        </span>
      ),
    },
    { accessorKey: "closeDate", header: "Closing Date", cell: ({ row }) => formatDate(row.original.closeDate, dateFormat) },
    { id: "region", header: "Region", accessorFn: (r) => region(r.regionId)?.name ?? "", cell: ({ row }) => <RegionBadge region={region(row.original.regionId)} /> },
    { accessorKey: "modelName", header: "Model" },
    { accessorKey: "vinChassisNo", header: "VIN" },
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
        layout={columnLayout ?? { order: [], hidden: ["modelName", "vinChassisNo"], freezeFirst: true }}
        columns={columns}
        data={rows}
        emptyState={<EmptyState title="No deals in this view" text="Try another view or clear the filters." />}
        rowActions={
          canEdit
            ? (r) => (
                <Link href={`/deals/${r.id}/edit`} className="rounded p-1 hover:bg-surface" aria-label={`Edit ${r.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              )
            : undefined
        }
      />
    </>
  );
}
