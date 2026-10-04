/** Display formats (prompt 17 §5): ₦ 12,500,000.00 · DD/MM/YYYY (user preference) · Africa/Lagos. */
export const DEFAULT_TIME_ZONE = "Africa/Lagos";
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

const money = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 });

export const formatMoney = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₦ ${money.format(v)}`);
export const formatMoneyCompact = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₦ ${compact.format(v)}`);

function parts(d: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function formatDate(
  v: string | Date | null | undefined,
  format: DateFormat = "DD/MM/YYYY",
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!v) return "—";
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return "—";
  const { y, m, d } = parts(date, timeZone);
  return format === "MM/DD/YYYY" ? `${m}/${d}/${y}` : format === "YYYY-MM-DD" ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}

export function formatDateTime(v: string | Date | null | undefined, format: DateFormat = "DD/MM/YYYY", timeZone = DEFAULT_TIME_ZONE) {
  if (!v) return "—";
  const date = new Date(v);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
  return `${formatDate(date, format, timeZone)} ${time}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
