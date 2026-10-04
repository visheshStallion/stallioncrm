"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUpDown, Columns3 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Generic list view (TanStack Table): client-side sort + quick filter over rows the server has already
 * scoped. Optional row selection (mass actions) and configurable columns (saved per view).
 */
export function DataTable<T extends { id: string }>({
  columns,
  data,
  emptyMessage = "No records.",
  filterPlaceholder = "Filter…",
  selectable = false,
  onSelectionChange,
  columnVisibility: initialVisibility,
  onColumnVisibilityChange,
  toolbar,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  emptyMessage?: string;
  filterPlaceholder?: string;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (v: VisibilityState) => void;
  toolbar?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(initialVisibility ?? {});
  const [showColumns, setShowColumns] = useState(false);

  const allColumns: ColumnDef<T, unknown>[] = selectable
    ? [
        {
          id: "_select",
          enableSorting: false,
          enableHiding: false,
          header: ({ table }) => (
            <input
              type="checkbox"
              aria-label="Select all"
              checked={table.getIsAllRowsSelected()}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
          ),
          cell: ({ row }) => (
            <input
              type="checkbox"
              aria-label="Select row"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
            />
          ),
        },
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (r) => r.id,
    state: { sorting, globalFilter, rowSelection, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(visibility) : updater;
      setVisibility(next);
      onColumnVisibilityChange?.(next);
    },
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  useEffect(() => {
    onSelectionChange?.(Object.keys(rowSelection).filter((k) => rowSelection[k]));
  }, [rowSelection, onSelectionChange]);

  // Clear selection when the data set changes (e.g. after a mass action refresh).
  useEffect(() => setRowSelection({}), [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={filterPlaceholder}
          className="max-w-xs"
          aria-label="Filter rows"
        />
        {toolbar}
        <div className="relative ml-auto">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted"
            onClick={() => setShowColumns((s) => !s)}
            aria-expanded={showColumns}
          >
            <Columns3 className="h-4 w-4" /> Columns
          </button>
          {showColumns ? (
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-card p-2 shadow-lg" data-testid="column-menu">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                    <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </label>
                ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-testid="data-row">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {table.getFilteredRowModel().rows.length} record(s)
        {selectable && Object.keys(rowSelection).length ? ` · ${Object.keys(rowSelection).length} selected` : ""}
      </p>
    </div>
  );
}
