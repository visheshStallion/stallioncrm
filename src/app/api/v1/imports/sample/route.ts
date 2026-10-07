import { NotFoundError } from "@/server/access/errors";
import { apiHandler } from "@/server/api";
import { toXlsx } from "@/lib/xlsx";
import { importModule } from "@/server/modules/imports/plan";
import { canImport } from "@/server/modules/imports/service";
import { requireApiContext } from "@/server/request";

/** Example rows per import module (fictitious data). */
const EXAMPLES: Record<string, Array<Array<string | number>>> = {
  priceBooks: [
    ["HMNL Retail 2026", "HMNL-SUV-STA", 40000000, 5, "HMNL"],
    ["HMNL Retail 2026", "HMNL-SED-BAS", 22500000, 3, "HMNL"],
  ],
};

/** Sample file of an import module: the column names the wizard maps automatically, plus example rows. `?module=&format=csv|xlsx` */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  if (!canImport(ctx)) throw new NotFoundError();
  const url = new URL(req.url);
  const mod = importModule(url.searchParams.get("module") ?? "");
  if (!mod) throw new NotFoundError();
  const headers = mod.fields.map((f) => f.label);
  const rows = (EXAMPLES[mod.key] ?? []).map((r) => r.slice(0, headers.length));
  const name = `sample-${mod.key}`;
  if (url.searchParams.get("format") === "xlsx") {
    return new Response(Buffer.from(toXlsx(mod.label.slice(0, 31), headers, rows)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
  }
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
});
