import { formatMoneyCompact } from "@/lib/format";

/**
 * Dependency-free SVG charts (server-rendered). Every chart has a text alternative: role="img" with a label,
 * and the pages render the same numbers as a table next to it.
 */
const PALETTE = ["#1565D0", "#0E9F6E", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#65A30D", "#DC2626", "#4B5563", "#B45309", "#4F46E5", "#0F766E"];
export const seriesColor = (i: number) => PALETTE[i % PALETTE.length]!;

export interface ChartSeries {
  name: string;
  values: number[];
}
export interface ChartProps {
  categories: string[];
  series: ChartSeries[];
  format?: "money" | "number";
  title: string;
}

const compact = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (v: number, format?: string) => (format === "money" ? formatMoneyCompact(v) : compact.format(v));
const short = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
      {series.map((s, i) => (
        <li key={s.name} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(i) }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return <p className="py-8 text-center text-[13px] text-text-muted">No data for this view.</p>;
}

const W = 560;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 34 };

/** Stacked bars: one bar per category, one segment per series. */
export function BarChart({ categories, series, format, title }: ChartProps) {
  if (categories.length === 0) return <Empty />;
  const totals = categories.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / categories.length;
  const bar = Math.min(56, slot * 0.64);
  return (
    <figure data-testid="chart" data-chart="bar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${categories.map((c, i) => `${c} ${fmt(totals[i]!, format)}`).join(", ")}`} className="w-full">
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-border" />
        {categories.map((c, i) => {
          const x = PAD.l + slot * i + (slot - bar) / 2;
          let y = H - PAD.b;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const h = (Math.max(0, s.values[i] ?? 0) / max) * innerH;
                y -= h;
                return h > 0 ? (
                  <rect key={s.name} x={x} y={y} width={bar} height={h} fill={seriesColor(si)} rx={1.5}>
                    <title>{`${c} · ${s.name}: ${fmt(s.values[i] ?? 0, format)}`}</title>
                  </rect>
                ) : null;
              })}
              <text x={x + bar / 2} y={y - 4} textAnchor="middle" className="fill-text text-[10px]">
                {fmt(totals[i]!, format)}
              </text>
              <text x={x + bar / 2} y={H - PAD.b + 14} textAnchor="middle" className="fill-text-muted text-[10px]">
                {short(c, Math.max(4, Math.floor(slot / 6)))}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </figure>
  );
}

export function LineChart({ categories, series, format, title }: ChartProps) {
  if (categories.length === 0) return <Empty />;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const innerW = W - PAD.l - PAD.r - 20;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + 10 + (categories.length === 1 ? innerW / 2 : (innerW * i) / (categories.length - 1));
  const y = (v: number) => H - PAD.b - (Math.max(0, v) / max) * innerH;
  const step = Math.ceil(categories.length / 8);
  return (
    <figure data-testid="chart" data-chart="line">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${series.map((s) => `${s.name} ${s.values.map((v, i) => `${categories[i]} ${fmt(v, format)}`).join(", ")}`).join("; ")}`} className="w-full">
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-border" />
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline fill="none" stroke={seriesColor(si)} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={seriesColor(si)}>
                <title>{`${categories[i]} · ${s.name}: ${fmt(v, format)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {categories.map((c, i) =>
          i % step === 0 ? (
            <text key={c} x={x(i)} y={H - PAD.b + 14} textAnchor="middle" className="fill-text-muted text-[10px]">
              {short(c, 9)}
            </text>
          ) : null,
        )}
      </svg>
      <Legend series={series} />
    </figure>
  );
}

/** Donut of the first series (one slice per category). */
export function PieChart({ categories, series, format, title }: ChartProps) {
  const values = categories.map((_, i) => Math.max(0, series.reduce((a, s) => a + (s.values[i] ?? 0), 0)));
  const total = values.reduce((a, v) => a + v, 0);
  if (total <= 0) return <Empty />;
  const R = 80;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <figure className="flex flex-wrap items-center gap-4" data-testid="chart" data-chart="pie">
      <svg viewBox="0 0 220 220" role="img" aria-label={`${title}: ${categories.map((c, i) => `${c} ${Math.round((values[i]! * 100) / total)}%`).join(", ")}`} className="w-44 shrink-0">
        <g transform="rotate(-90 110 110)">
          {values.map((v, i) => {
            const len = (v / total) * C;
            const el = (
              <circle key={i} cx={110} cy={110} r={R} fill="none" stroke={seriesColor(i)} strokeWidth={34} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}>
                <title>{`${categories[i]}: ${fmt(v, format)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text x={110} y={114} textAnchor="middle" className="fill-text text-[13px] font-semibold">
          {fmt(total, format)}
        </text>
      </svg>
      <ul className="space-y-1 text-[12px]">
        {categories.slice(0, 12).map((c, i) => (
          <li key={c} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(i) }} aria-hidden="true" />
            <span className="max-w-[160px] truncate">{c}</span>
            <span className="text-text-muted">
              {fmt(values[i]!, format)} · {Math.round((values[i]! * 100) / total)}%
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Funnel: centred bars in the order of the categories. */
export function FunnelChart({ categories, series, format, title }: ChartProps) {
  const values = categories.map((_, i) => Math.max(0, series.reduce((a, s) => a + (s.values[i] ?? 0), 0)));
  const max = Math.max(...values, 0);
  if (max <= 0) return <Empty />;
  return (
    <figure data-testid="chart" data-chart="funnel" role="img" aria-label={`${title}: ${categories.map((c, i) => `${c} ${fmt(values[i]!, format)}`).join(", ")}`}>
      <ol className="space-y-1.5">
        {categories.map((c, i) => (
          <li key={c} className="grid grid-cols-[110px_1fr_90px] items-center gap-2 text-[12px]">
            <span className="truncate">{c}</span>
            <span className="flex justify-center">
              <span className="block h-6 rounded" style={{ width: `${Math.max(2, (values[i]! / max) * 100)}%`, background: seriesColor(i) }} />
            </span>
            <span className="text-right text-text-muted">
              {fmt(values[i]!, format)}
              {i > 0 && values[0]! > 0 ? ` · ${Math.round((values[i]! * 100) / values[0]!)}%` : ""}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function Chart({ type, ...props }: ChartProps & { type: "bar" | "line" | "pie" | "funnel" }) {
  return type === "line" ? <LineChart {...props} /> : type === "pie" ? <PieChart {...props} /> : type === "funnel" ? <FunnelChart {...props} /> : <BarChart {...props} />;
}

/** Target meter: won vs target, with the forecast as a marker. */
export function TargetMeter({ label, target, won, forecast, attainment }: { label: string; target: number; won: number; forecast: number; attainment: number | null }) {
  const scale = Math.max(target, forecast, won, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div data-testid="target-meter">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold">{attainment === null ? "—" : `${attainment}%`}</span>
        <span className="text-xs text-text-muted">{target > 0 ? "of target" : "no target set"}</span>
        <span className="ml-auto text-xs text-text-muted">{label}</span>
      </div>
      <div className="relative h-4 rounded-full bg-muted" role="img" aria-label={`Won ${formatMoneyCompact(won)} of target ${formatMoneyCompact(target)}; forecast ${formatMoneyCompact(forecast)}`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: pct(won) }} />
        <span className="absolute inset-y-[-3px] w-0.5 bg-text" style={{ left: pct(forecast) }} title="Forecast" />
        {target > 0 ? <span className="absolute inset-y-[-3px] w-0.5 bg-primary" style={{ left: pct(target) }} title="Target" /> : null}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-text-muted">Won</dt>
          <dd className="font-semibold">{formatMoneyCompact(won)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Forecast</dt>
          <dd className="font-semibold">{formatMoneyCompact(forecast)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Target</dt>
          <dd className="font-semibold">{target > 0 ? formatMoneyCompact(target) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
