"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import Link from "next/link";
import { RememberListIds } from "@/components/crm/KeyboardShortcuts";
import { EmptyState } from "@/components/crm/primitives";
import { DataTable } from "@/components/DataTable";
import type { ColumnLayout } from "@/server/modules/preferences/schema";

export interface CustomerColumn {
  key: string;
  label: string;
  /** Link the cell to `${basePath}/${row.id}` (or to `linkTo(row)`). */
  link?: boolean;
  linkKey?: string;
  linkBase?: string;
  /** Show a lock when the viewer only has the basic tier (value is masked). */
  maskedAtBasic?: boolean;
}

type Row = { id: string; tier: string } & Record<string, unknown>;

/** Shared list table for Accounts and Contacts. Values arrive already masked per the viewer's tier. */
export function CustomerTable({
  module,
  basePath,
  rows,
  columns,
  layout,
  emptyTitle,
}: {
  module: string;
  basePath: string;
  rows: Row[];
  columns: CustomerColumn[];
  layout: ColumnLayout | null;
  emptyTitle: string;
}) {
  const defs: ColumnDef<Row, unknown>[] = columns.map((c) => ({
    id: c.key,
    accessorFn: (r) => r[c.key] ?? "",
    header: c.label,
    cell: ({ row }) => {
      const v = row.original[c.key];
      if (v === null || v === undefined || v === "") return <span className="text-text-muted">—</span>;
      if (c.link) {
        const id = c.linkKey ? row.original[c.linkKey] : row.original.id;
        return (
          <Link href={`${c.linkBase ?? basePath}/${String(id)}`} className="font-medium text-primary hover:underline">
            {String(v)}
          </Link>
        );
      }
      if (c.maskedAtBasic && row.original.tier === "BASIC") {
        return (
          <span className="inline-flex items-center gap-1" title="Masked – you have no records with this customer">
            <Lock className="h-3 w-3 text-text-muted" aria-label="masked" />
            {String(v)}
          </span>
        );
      }
      return String(v);
    },
  }));
  return (
    <>
      <RememberListIds module={module} ids={rows.map((r) => r.id)} />
      <DataTable module={module} layout={layout} columns={defs} data={rows} emptyState={<EmptyState title={emptyTitle} text="Try another search or clear the filters." />} />
    </>
  );
}
