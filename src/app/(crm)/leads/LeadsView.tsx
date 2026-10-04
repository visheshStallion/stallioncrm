"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Mail, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { RememberListIds } from "@/components/crm/KeyboardShortcuts";
import { Avatar, EmptyState, StatusPill } from "@/components/crm/primitives";
import { ratingTone, statusTone } from "@/components/crm/tones";
import { DataTable } from "@/components/DataTable";
import { Kanban, rejectMove } from "@/components/Kanban";
import { RegionBadge } from "@/components/RegionBadge";
import { toast, toastResult } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import { inlineEditLeadAction, massOwnerAction, massStatusAction } from "@/server/modules/leads/actions";
import type { LeadRow } from "@/server/modules/leads/queries";
import { LEAD_SOURCES, LEAD_STATUSES, RATINGS, SETTABLE_STATUSES, SOURCE_LABELS, STATUS_LABELS } from "@/server/modules/leads/schema";
import type { ColumnLayout } from "@/server/modules/preferences/schema";

type Brand = { id: string; code: string; name: string; color: string | null };
type Region = { id: string; name: string };


const KANBAN_BY = {
  status: { label: "Lead status", values: LEAD_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s] })) },
  rating: { label: "Rating", values: RATINGS.map((r) => ({ key: r, label: r.charAt(0) + r.slice(1).toLowerCase() })) },
  source: { label: "Lead source", values: LEAD_SOURCES.map((s) => ({ key: s, label: SOURCE_LABELS[s] })) },
} as const;
export type KanbanBy = keyof typeof KANBAN_BY;

export function LeadsView({
  layout,
  kanbanBy,
  rows,
  brands,
  regions,
  users,
  canEdit,
  canMassUpdate,
  exportHref,
  dateFormat,
  columnLayout,
}: {
  layout: "list" | "kanban";
  kanbanBy: KanbanBy;
  rows: LeadRow[];
  brands: Brand[];
  regions: Region[];
  users: Array<{ id: string; name: string }>;
  canEdit: boolean;
  canMassUpdate: boolean;
  exportHref: string | null;
  dateFormat: DateFormat;
  columnLayout: ColumnLayout | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const brand = (id: string) => brands.find((b) => b.id === id);
  const region = (id: string) => regions.find((r) => r.id === id);

  if (layout === "kanban") {
    const by = KANBAN_BY[kanbanBy];
    return (
      <Kanban
        kanbanBy={{ current: kanbanBy, options: Object.entries(KANBAN_BY).map(([value, v]) => ({ value, label: v.label })) }}
        columns={by.values.map((v) => ({
          key: v.key,
          label: v.label,
          cards: rows
            .filter((r) => r[kanbanBy] === v.key)
            .map((r) => ({
              id: r.id,
              title: r.name,
              subtitle: [r.modelName, r.city].filter(Boolean).join(" · "),
              href: `/leads/${r.id}`,
              amount: r.budget,
              date: formatDate(r.createdAt, dateFormat),
              ownerName: r.ownerName,
              brand: brand(r.brandId),
              badges: (
                <>
                  <BrandBadge brand={brand(r.brandId)} />
                  {kanbanBy !== "status" ? <StatusPill tone={statusTone(r.status)}>{STATUS_LABELS[r.status as keyof typeof STATUS_LABELS]}</StatusPill> : null}
                </>
              ),
            })),
        }))}
        onMove={
          canEdit
            ? async (id, to) => {
                if (kanbanBy === "status" && to === "CONVERTED") return rejectMove("Use Convert on the lead to convert it");
                if (kanbanBy === "status" && to === "UNQUALIFIED") return rejectMove("Open the lead to mark it unqualified with a reason");
                const res = await inlineEditLeadAction(id, kanbanBy, to);
                if (!res.ok) return rejectMove(res.error.message);
                toast(res.data.message ?? "Lead updated successfully", "success");
                return true;
              }
            : undefined
        }
      />
    );
  }

  const statusOptions = SETTABLE_STATUSES.filter((s) => s !== "UNQUALIFIED").map((s) => ({ value: s, label: STATUS_LABELS[s] }));
  const columns: ColumnDef<LeadRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Lead Name",
      cell: ({ row }) => (
        <Link href={`/leads/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { id: "brand", header: "Brand", accessorFn: (r) => brand(r.brandId)?.code ?? "", cell: ({ row }) => <BrandBadge brand={brand(row.original.brandId)} /> },
    { accessorKey: "mobile", header: "Mobile" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "city", header: "City", meta: canEdit ? { editable: { type: "text" } } : undefined },
    { id: "region", header: "Region", accessorFn: (r) => region(r.regionId)?.name ?? "", cell: ({ row }) => <RegionBadge region={region(row.original.regionId)} /> },
    {
      accessorKey: "source",
      header: "Lead Source",
      cell: ({ row }) => SOURCE_LABELS[row.original.source as keyof typeof SOURCE_LABELS],
      meta: canEdit ? { editable: { type: "select", options: LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })) } } : undefined,
    },
    {
      accessorKey: "status",
      header: "Lead Status",
      cell: ({ row }) => <StatusPill tone={statusTone(row.original.status)}>{STATUS_LABELS[row.original.status as keyof typeof STATUS_LABELS]}</StatusPill>,
      meta: canEdit ? { editable: { type: "select", options: statusOptions } } : undefined,
    },
    {
      accessorKey: "rating",
      header: "Rating",
      cell: ({ row }) => (row.original.rating ? <StatusPill tone={ratingTone(row.original.rating)}>{row.original.rating}</StatusPill> : null),
      meta: canEdit ? { editable: { type: "select", options: RATINGS.map((r) => ({ value: r, label: r })) } } : undefined,
    },
    { accessorKey: "modelName", header: "Model" },
    { accessorKey: "budget", header: "Budget", cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.budget)}</span> },
    {
      accessorKey: "ownerName",
      header: "Lead Owner",
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <Avatar name={row.original.ownerName} size={20} />
          {row.original.ownerName}
        </span>
      ),
    },
    { accessorKey: "createdAt", header: "Created Time", cell: ({ row }) => formatDate(row.original.createdAt, dateFormat) },
  ];

  const run = (fn: () => Promise<{ ok: boolean; data?: { message?: string }; error?: { message: string } }>, clear: () => void) =>
    start(async () => {
      const res = await fn();
      toastResult(res as never, res.ok ? res.data?.message : undefined);
      if (res.ok) clear();
      router.refresh();
    });

  return (
    <>
      <RememberListIds module="leads" ids={rows.map((r) => r.id)} />
      <DataTable
        module="leads"
        layout={columnLayout ?? { order: [], hidden: ["email", "modelName", "budget"], freezeFirst: true }}
        columns={columns}
        data={rows}
        selectable={canMassUpdate || !!exportHref}
        emptyState={
          <EmptyState
            title="No leads in this view"
            text="Try another view, clear the filters, or create a lead."
            actions={
              canEdit ? (
                <Button asChild size="sm">
                  <Link href="/leads/new">Create Lead</Link>
                </Button>
              ) : undefined
            }
          />
        }
        onCellEdit={
          canEdit
            ? async (row, col, value) => {
                const res = await inlineEditLeadAction(row.id, col, value);
                toastResult(res, res.ok ? res.data.message : undefined);
                if (res.ok) router.refresh();
                return res.ok;
              }
            : undefined
        }
        rowActions={(r) => (
          <>
            <Link href={`/leads/${r.id}/edit`} className="rounded p-1 hover:bg-surface" aria-label={`Edit ${r.name}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Link>
            {r.email ? (
              <a href={`mailto:${r.email}`} className="rounded p-1 hover:bg-surface" aria-label={`Email ${r.name}`}>
                <Mail className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {r.mobile ? (
              <a href={`tel:${r.mobile}`} className="rounded p-1 hover:bg-surface" aria-label={`Call ${r.name}`}>
                <Phone className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </>
        )}
        bulkBar={(ids, clear) => (
          <>
            {canMassUpdate ? (
              <>
                <Select
                  aria-label="Change owner"
                  defaultValue=""
                  disabled={pending}
                  onChange={(e) => {
                    const ownerId = e.target.value;
                    e.target.value = "";
                    if (ownerId) run(() => massOwnerAction(ids, ownerId), clear);
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
                  aria-label="Mass update status"
                  defaultValue=""
                  disabled={pending}
                  onChange={(e) => {
                    const status = e.target.value;
                    e.target.value = "";
                    if (!status) return;
                    const reason = status === "UNQUALIFIED" ? window.prompt("Reason") ?? "" : undefined;
                    run(() => massStatusAction(ids, status, reason), clear);
                  }}
                  className="h-8 text-xs"
                >
                  <option value="">Mass update status…</option>
                  {SETTABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}
            {exportHref ? (
              <Button asChild size="sm" variant="outline">
                <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}ids=${ids.join(",")}`}>Export</a>
              </Button>
            ) : null}
          </>
        )}
      />
    </>
  );
}
