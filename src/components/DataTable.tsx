"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, Columns3, GripVertical } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setPreferenceAction } from "@/server/modules/preferences/actions";
import type { ColumnLayout } from "@/server/modules/preferences/schema";

/** Column metadata understood by DataTable. */
export interface ColumnMeta {
  /** Inline edit on double-click (only pass for fields the user may edit). */
  editable?: { type: "text" | "select"; options?: Array<{ value: string; label: string }> };
}

const VIRTUALIZE_AFTER = 500;

/**
 * CRM data table (TanStack): sorting, column chooser (drag reorder, show/hide, freeze first column – saved per
 * user), row selection with a bulk-action bar, double-click inline edit, hover quick actions, sticky header and
 * row virtualisation above 500 rows. Rows are already scoped by the server.
 */
export function DataTable<T extends { id: string }>({
  columns,
  data,
  module,
  layout: initialLayout,
  emptyState,
  emptyMessage = "No records.",
  selectable = false,
  onSelectionChange,
  bulkBar,
  toolbar,
  rowActions,
  onCellEdit,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Enables the saved column layout (preference key `columns:<module>`). */
  module?: string;
  layout?: ColumnLayout | null;
  emptyState?: ReactNode;
  emptyMessage?: string;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  bulkBar?: (selectedIds: string[], clear: () => void) => ReactNode;
  toolbar?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  onCellEdit?: (row: T, columnId: string, value: string) => Promise<boolean>;
}) {
  const ids = useMemo(() => columns.map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey ?? ""), [columns]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [order, setOrder] = useState<string[]>(() => mergeOrder(ids, initialLayout?.order));
  const [hidden, setHidden] = useState<Set<string>>(new Set(initialLayout?.hidden ?? []));
  const [freeze, setFreeze] = useState(initialLayout?.freezeFirst ?? true);
  const [chooser, setChooser] = useState(false);
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allColumns: ColumnDef<T, unknown>[] = useMemo(
    () =>
      selectable
        ? [
            {
              id: "_select",
              enableSorting: false,
              header: ({ table }) => (
                <input type="checkbox" aria-label="Select all" checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} />
              ),
              cell: ({ row }) => <input type="checkbox" aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />,
            },
            ...columns,
          ]
        : columns,
    [columns, selectable],
  );

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (r) => r.id,
    state: {
      sorting,
      rowSelection,
      columnVisibility: Object.fromEntries([...hidden].map((h) => [h, false])),
      columnOrder: ["_select", ...order],
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  useEffect(() => onSelectionChange?.(selectedIds), [selectedIds.join(","), onSelectionChange]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setRowSelection({}), [data]);

  const rows = table.getRowModel().rows;
  const virtual = rows.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
    enabled: virtual,
  });
  const vItems = virtual ? virtualizer.getVirtualItems() : [];
  const padTop = virtual && vItems.length ? vItems[0]!.start : 0;
  const padBottom = virtual && vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1]!.end : 0;
  const renderRows = virtual ? vItems.map((v) => rows[v.index]!) : rows;
  const firstDataCol = order.find((c) => !hidden.has(c));

  const saveLayout = async () => {
    if (!module) return setChooser(false);
    const res = await setPreferenceAction(`columns:${module}`, { order, hidden: [...hidden], freezeFirst: freeze });
    toast(res.ok ? "Column layout saved" : res.error.message, res.ok ? "success" : "error");
    setChooser(false);
  };

  const headerLabel = (id: string) => {
    const col = columns.find((c) => (c.id ?? (c as { accessorKey?: string }).accessorKey) === id);
    return typeof col?.header === "string" ? col.header : id;
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selectedIds.length && bulkBar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/10 px-2 py-1" data-testid="bulk-bar">
            <span className="text-xs font-semibold text-primary">{selectedIds.length} selected</span>
            {bulkBar(selectedIds, () => setRowSelection({}))}
            <button type="button" className="text-xs underline" onClick={() => setRowSelection({})}>
              Clear
            </button>
          </div>
        ) : (
          toolbar
        )}
        <div className="relative ml-auto">
          <Button type="button" size="sm" variant="outline" onClick={() => setChooser((s) => !s)} aria-expanded={chooser} aria-label="Columns">
            <Columns3 className="h-4 w-4" />
          </Button>
          {chooser ? (
            <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-border bg-surface p-2 shadow-lg" data-testid="column-menu">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase text-text-muted">Columns (drag to reorder)</p>
              <ul>
                {order.map((id, idx) => (
                  <li
                    key={id}
                    draggable
                    onDragStart={() => (dragFrom.current = idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const from = dragFrom.current;
                      if (from === null || from === idx) return;
                      setOrder((o) => {
                        const n = [...o];
                        const [m] = n.splice(from, 1);
                        n.splice(idx, 0, m!);
                        return n;
                      });
                    }}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
                  >
                    <GripVertical className="h-3.5 w-3.5 cursor-grab text-text-muted" aria-hidden="true" />
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!hidden.has(id)}
                        onChange={() =>
                          setHidden((h) => {
                            const n = new Set(h);
                            if (n.has(id)) n.delete(id);
                            else n.add(id);
                            return n;
                          })
                        }
                      />
                      {headerLabel(id)}
                    </label>
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2 border-t border-border px-1 pt-2 text-sm">
                <input type="checkbox" checked={freeze} onChange={() => setFreeze((f) => !f)} /> Freeze first column
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setChooser(false)}>
                  Close
                </Button>
                {module ? (
                  <Button size="sm" type="button" onClick={saveLayout}>
                    Save layout
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className={cn("overflow-auto rounded-lg border border-border bg-surface", virtual ? "max-h-[70vh]" : "max-h-[calc(100vh-240px)]")}>
        <table className="crm-table w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn(
                      "h-9 whitespace-nowrap border-b border-border px-3 text-left text-[12px] font-semibold text-text-muted",
                      freeze && (h.column.id === "_select" || h.column.id === firstDataCol) && "sticky z-20 bg-muted",
                      freeze && h.column.id === "_select" && "left-0 w-9",
                      freeze && h.column.id === firstDataCol && (selectable ? "left-9" : "left-0"),
                    )}
                  >
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
                {rowActions ? <th className="w-24 border-b border-border" aria-label="Quick actions" /> : null}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 ? <tr style={{ height: padTop }} /> : null}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length + 1}>{emptyState ?? <p className="py-10 text-center text-text-muted">{emptyMessage}</p>}</td>
              </tr>
            ) : (
              renderRows.map((row) => (
                <tr key={row.id} data-testid="data-row" className="group hover:bg-muted/60">
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                    const isEditing = editing?.row === row.id && editing.col === cell.column.id;
                    return (
                      <td
                        key={cell.id}
                        onDoubleClick={meta?.editable && onCellEdit ? () => setEditing({ row: row.id, col: cell.column.id }) : undefined}
                        title={meta?.editable && onCellEdit ? "Double-click to edit" : undefined}
                        className={cn(
                          "whitespace-nowrap border-b border-border px-3",
                          freeze && (cell.column.id === "_select" || cell.column.id === firstDataCol) && "sticky z-[5] bg-surface group-hover:bg-muted",
                          freeze && cell.column.id === "_select" && "left-0",
                          freeze && cell.column.id === firstDataCol && (selectable ? "left-9" : "left-0"),
                        )}
                      >
                        {isEditing && meta?.editable ? (
                          <InlineEditor
                            meta={meta.editable}
                            initial={String(cell.getValue() ?? "")}
                            onCancel={() => setEditing(null)}
                            onSave={async (v) => {
                              const ok = await onCellEdit!(row.original, cell.column.id, v);
                              if (ok) setEditing(null);
                            }}
                          />
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    );
                  })}
                  {rowActions ? (
                    <td className="border-b border-border px-2">
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{rowActions(row.original)}</div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
            {padBottom > 0 ? <tr style={{ height: padBottom }} /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineEditor({
  meta,
  initial,
  onSave,
  onCancel,
}: {
  meta: NonNullable<ColumnMeta["editable"]>;
  initial: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSave(v);
    if (e.key === "Escape") onCancel();
  };
  return meta.type === "select" ? (
    <select autoFocus value={v} onChange={(e) => onSave(e.target.value)} onBlur={onCancel} onKeyDown={keys} className="h-7 rounded border border-primary bg-surface px-1 text-[13px]" aria-label="Edit value">
      {meta.options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ) : (
    <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} onKeyDown={keys} className="h-7 w-full rounded border border-primary bg-surface px-1 text-[13px]" aria-label="Edit value" />
  );
}

function mergeOrder(ids: string[], saved?: string[]): string[] {
  if (!saved?.length) return ids;
  const known = saved.filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}
