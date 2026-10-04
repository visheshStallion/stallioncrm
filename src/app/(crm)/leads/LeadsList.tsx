"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { DataTable } from "@/components/DataTable";
import { RegionBadge } from "@/components/RegionBadge";
import { toast, toastResult } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { massOwnerAction, massStatusAction, saveViewAction } from "@/server/modules/leads/actions";
import type { LeadRow } from "@/server/modules/leads/queries";
import { SETTABLE_STATUSES, SOURCE_LABELS, STATUS_LABELS, type LeadFilters } from "@/server/modules/leads/schema";

type Brand = { id: string; code: string; name: string; color: string | null };
type Region = { id: string; name: string };

export const DEFAULT_HIDDEN: VisibilityState = { email: false, budget: false, modelName: false, createdAt: false };

export function LeadsList({
  rows,
  brands,
  regions,
  users,
  canMassUpdate,
  exportHref,
  filters,
  columnVisibility,
}: {
  rows: LeadRow[];
  brands: Brand[];
  regions: Region[];
  users: Array<{ id: string; name: string }>;
  canMassUpdate: boolean;
  exportHref: string | null;
  filters: LeadFilters;
  columnVisibility: VisibilityState | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(columnVisibility ?? DEFAULT_HIDDEN);
  const [pending, start] = useTransition();
  const brand = (id: string) => brands.find((b) => b.id === id);
  const region = (id: string) => regions.find((r) => r.id === id);
  const onSelection = useCallback((ids: string[]) => setSelected(ids), []);

  const columns: ColumnDef<LeadRow, unknown>[] = [
    {
      id: "brand",
      header: "Brand",
      accessorFn: (r) => brand(r.brandId)?.code ?? "",
      cell: ({ row }) => <BrandBadge brand={brand(row.original.brandId)} />,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link href={`/leads/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "mobile", header: "Mobile" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "city", header: "City" },
    {
      id: "region",
      header: "Region",
      accessorFn: (r) => region(r.regionId)?.name ?? "",
      cell: ({ row }) => <RegionBadge region={region(row.original.regionId)} />,
    },
    { accessorKey: "source", header: "Source", cell: ({ row }) => SOURCE_LABELS[row.original.source as keyof typeof SOURCE_LABELS] },
    { accessorKey: "status", header: "Status", cell: ({ row }) => STATUS_LABELS[row.original.status as keyof typeof STATUS_LABELS] },
    { accessorKey: "rating", header: "Rating" },
    { accessorKey: "modelName", header: "Model" },
    { accessorKey: "budget", header: "Budget", cell: ({ row }) => formatMoney(row.original.budget) },
    { accessorKey: "ownerName", header: "Owner" },
    { accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
  ];

  const run = (fn: () => Promise<{ ok: boolean; data?: { message?: string }; error?: { message: string } }>) =>
    start(async () => {
      const res = await fn();
      toastResult(res as never, res.ok ? res.data?.message : undefined);
      router.refresh();
    });

  const saveView = () => {
    const name = window.prompt("Name for this view");
    if (!name) return;
    const columns = Object.entries(visibility)
      .filter(([, v]) => v === false)
      .map(([k]) => `-${k}`);
    start(async () => {
      const res = await saveViewAction({ name, filters, columns });
      if (!res.ok) return toast(res.error.message, "error");
      toast(`View “${name}” saved`, "success");
      router.push(`/leads?view=${res.data.id}`);
    });
  };

  const toolbar = (
    <>
      {canMassUpdate && selected.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1" data-testid="mass-actions">
          <span className="text-xs">{selected.length} selected</span>
          <Select
            aria-label="Change owner"
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const ownerId = e.target.value;
              if (ownerId) run(() => massOwnerAction(selected, ownerId));
              e.target.value = "";
            }}
            className="h-8 text-xs"
          >
            <option value="">Change owner…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Set status"
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const status = e.target.value;
              e.target.value = "";
              if (!status) return;
              const reason = status === "UNQUALIFIED" ? window.prompt("Reason") ?? "" : undefined;
              run(() => massStatusAction(selected, status, reason));
            }}
            className="h-8 text-xs"
          >
            <option value="">Set status…</option>
            {SETTABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {exportHref ? (
            <Button asChild size="sm" variant="outline">
              <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}ids=${selected.join(",")}`}>Export selected</a>
            </Button>
          ) : null}
        </div>
      ) : null}
      {exportHref ? (
        <Button asChild size="sm" variant="ghost">
          <a href={exportHref}>Export</a>
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" type="button" onClick={saveView} disabled={pending}>
        Save view
      </Button>
    </>
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No leads in your scope match."
      filterPlaceholder="Quick filter…"
      selectable={canMassUpdate || !!exportHref}
      onSelectionChange={onSelection}
      columnVisibility={visibility}
      onColumnVisibilityChange={setVisibility}
      toolbar={toolbar}
    />
  );
}

/** Saved `columns` ("-email" = hidden) → visibility state. */
export function visibilityFromColumns(columns: unknown): VisibilityState | null {
  if (!Array.isArray(columns)) return null;
  return Object.fromEntries(columns.filter((c): c is string => typeof c === "string" && c.startsWith("-")).map((c) => [c.slice(1), false]));
}

export function SearchBox({ defaultValue }: { defaultValue?: string }) {
  return <Input name="q" defaultValue={defaultValue} placeholder="Name, mobile or email" className="w-56" aria-label="Search leads" />;
}
