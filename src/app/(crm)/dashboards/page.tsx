import Link from "next/link";
import { forbidden } from "next/navigation";
import { Chart, TargetMeter } from "@/components/charts";
import { PrintPageButton } from "@/components/crm/PrintActions";
import { PrintLetterhead } from "@/components/crm/PrintLetterhead";
import { PageTitleRow } from "@/components/crm/primitives";
import { ReportTable } from "@/components/crm/ReportTable";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { DASHBOARDS, defaultDashboard, loadDashboard, type WidgetData, type WidgetDef } from "@/server/modules/dashboards/service";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Analytics" };

const SPAN: Record<number, string> = { 1: "xl:col-span-1", 2: "md:col-span-2", 3: "md:col-span-2 xl:col-span-3", 4: "md:col-span-2 xl:col-span-4" };
const number = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 1 });

/**
 * Dashboards (prompt 09). One definition per dashboard; the numbers come from the viewer's access context, so
 * the Brand dashboard shows a Brand Manager their brand and the Head of Sales every brand.
 */
export default async function DashboardsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "dashboards", "read")) forbidden();
  const [ui, prefs] = await Promise.all([getUiFilters(ctx), getPreferences(ctx)]);
  const { dashboard, widgets } = await loadDashboard(ctx, d ?? defaultDashboard(ctx), ui);

  const body = (def: WidgetDef, data: WidgetData) => {
    switch (data.type) {
      case "kpi":
        return (
          <div data-testid={`kpi-${def.id}`}>
            <div className="text-[24px] font-semibold leading-tight" title={data.format === "money" ? formatMoney(data.value) : undefined}>
              {data.format === "money" ? formatMoneyCompact(data.value) : data.format === "percent" ? `${number.format(data.value)}%` : number.format(data.value)}
            </div>
            {data.sub ? <div className="text-xs text-text-muted">{data.sub}</div> : null}
          </div>
        );
      case "chart":
        return <Chart type={data.chart} title={def.title} categories={data.categories} series={data.series} format={data.format} />;
      case "table":
        return <ReportTable columns={data.columns} rows={data.rows} links={data.links} dateFormat={prefs.dateFormat} dense />;
      case "meter":
        return <TargetMeter {...data} />;
      case "leaderboard":
        return data.rows.length ? (
          <ol className="divide-y divide-border" data-testid="leaderboard">
            {data.rows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="w-5 text-right text-xs text-text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="hidden text-xs text-text-muted sm:block">{r.sub}</span>
                <span className="w-24 text-right tabular-nums">{formatMoneyCompact(r.value)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-[13px] text-text-muted">No sales activity in this period.</p>
        );
    }
  };

  return (
    <div>
      <PrintLetterhead ctx={ctx} title="Analytics dashboard" />
      <PageTitleRow title="Analytics" left={<span className="text-[13px] text-text-muted">{dashboard.audience} · you see the data you are allowed to see</span>} actions={<PrintPageButton />} />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Dashboards">
        {DASHBOARDS.map((x) => (
          <Link
            key={x.key}
            href={`/dashboards?d=${x.key}`}
            aria-current={x.key === dashboard.key ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1 text-[13px] font-semibold", x.key === dashboard.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted")}
          >
            {x.name}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="dashboard" data-dashboard={dashboard.key}>
        {widgets.map(({ def, data }) => (
          <section key={def.id} className={cn("flex flex-col rounded-lg border border-border bg-surface", SPAN[def.span])} data-testid={`widget-${def.id}`}>
            <header className="flex items-center border-b border-border px-4 py-2">
              <h2 className="text-[13px] font-semibold">{def.title}</h2>
              {def.href ? (
                <Link href={def.href} className="ml-auto text-xs text-primary hover:underline" aria-label={`Open: ${def.title}`}>
                  Open
                </Link>
              ) : null}
            </header>
            <div className={cn("flex-1", data.type === "table" ? "" : "p-4")}>{body(def, data)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
