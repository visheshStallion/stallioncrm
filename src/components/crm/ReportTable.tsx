import Link from "next/link";
import { formatDate, formatMoney, type DateFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });

export function formatCell(v: string | number | null, type: string, dateFormat: DateFormat): string {
  if (v === null || v === "") return "—";
  if (type === "money") return formatMoney(Number(v));
  if (type === "percent") return `${number.format(Number(v))}%`;
  if (type === "number") return number.format(Number(v));
  if (type === "date") return formatDate(String(v), dateFormat);
  return String(v);
}
const numeric = (t: string) => t === "money" || t === "number" || t === "percent";

/** Result table of a report / dashboard widget. `links[i]` turns the first cell of row i into a link. */
export function ReportTable({
  columns,
  rows,
  links,
  dateFormat,
  dense,
}: {
  columns: Array<{ label: string; type: string }>;
  rows: Array<Array<string | number | null>>;
  links?: Array<string | null>;
  dateFormat: DateFormat;
  dense?: boolean;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-text-muted">No records match this report.</p>;
  const pad = dense ? "px-2 py-1" : "px-3 py-2";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" data-testid="report-table">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
            {columns.map((c, i) => (
              <th key={i} scope="col" className={cn(pad, numeric(c.type) && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {row.map((v, i) => (
                <td key={i} className={cn(pad, numeric(columns[i]!.type) && "text-right tabular-nums")}>
                  {i === 0 && links?.[r] ? (
                    <Link href={links[r]!} className="font-medium text-primary hover:underline">
                      {formatCell(v, columns[i]!.type, dateFormat)}
                    </Link>
                  ) : (
                    formatCell(v, columns[i]!.type, dateFormat)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
