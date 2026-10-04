import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { TargetMeter } from "@/components/charts";
import { PageTitleRow } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { scopedDb } from "@/server/db";
import { addForecastNoteAction, deleteForecastNoteAction, setTargetAction } from "@/server/modules/forecasts/actions";
import { canAnnotate, canSetTargets, getForecast, monthOf, parsePeriod, quarterOf, shiftPeriod, viewerNode, type ForecastNode } from "@/server/modules/forecasts/service";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Forecasts" };

const INDENT: Record<ForecastNode["level"], string> = { group: "pl-3", brand: "pl-3", region: "pl-8", user: "pl-14" };

/**
 * Forecast vs target with drill-down Group → Brand → Region → Exec (prompt 09). `?focus=` opens one branch.
 * The roll-up only contains deals the viewer may see.
 */
export default async function ForecastsPage({ searchParams }: { searchParams: Promise<{ period?: string; focus?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "forecasts", "read")) forbidden();
  const period = parsePeriod(sp.period);
  const [ui, prefs] = await Promise.all([getUiFilters(ctx), getPreferences(ctx)]);
  const root = await getForecast(ctx, period, ui);
  const me = viewerNode(ctx, root);
  const allBrands = await scopedDb(ctx).brand.findMany({ where: { id: { in: ctx.brandIds }, status: "ACTIVE" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const targetBrands = allBrands.filter((b) => canSetTargets(ctx, b.id));
  const [regions, users] = targetBrands.length
    ? await Promise.all([
        scopedDb(ctx).region.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        scopedDb(ctx).user.findMany({ where: { active: true, profile: { scope: "TERRITORY" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const href = (p: string, focus?: string) => `/forecasts?period=${p}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`;
  // Drill-down: `focus` is the key of the opened brand ("b:<brand>") or region ("r:<brand>:<region>").
  const focus = sp.focus ?? "";
  const singleRegion = root.children.length === 1 && root.children[0]!.children.length === 1;
  const isOpen = (n: ForecastNode) =>
    n.level === "group" ||
    (n.level === "brand" && (root.children.length === 1 || focus === n.key || focus.startsWith(`r:${n.brandId}:`))) ||
    (n.level === "region" && (focus === n.key || singleRegion));
  const rows: ForecastNode[] = [];
  const walk = (n: ForecastNode) => {
    rows.push(n);
    if (isOpen(n)) n.children.forEach(walk);
  };
  walk(root);
  const noteTargets = rows.filter((n) => n.level !== "group" && n.brandId && canAnnotate(ctx, n.brandId, n.regionId));
  const notes = rows.flatMap((n) => n.notes.map((x) => ({ ...x, on: n.label })));
  const tab = "rounded-md border px-3 py-1 text-xs font-semibold";

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow title="Forecasts" left={<span className="text-[13px] text-text-muted">won + committed (Booking and later) + weighted pipeline, for deals closing in the period</span>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href(shiftPeriod(period, -1))} className={cn(tab, "border-border hover:bg-muted")} aria-label="Previous period">
          ‹
        </Link>
        <h2 className="min-w-36 text-center text-sm font-semibold" data-testid="forecast-period">
          {period.label}
        </h2>
        <Link href={href(shiftPeriod(period, 1))} className={cn(tab, "border-border hover:bg-muted")} aria-label="Next period">
          ›
        </Link>
        <Link href={href(monthOf(period))} className={cn(tab, period.type === "MONTH" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
          Month
        </Link>
        <Link href={href(quarterOf(period))} className={cn(tab, period.type === "QUARTER" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
          Quarter
        </Link>
      </div>

      <section className="mb-4 rounded-lg border border-border bg-surface p-4">
        <TargetMeter label={me.label} target={me.target} won={me.won} forecast={me.forecast} attainment={me.attainment} />
      </section>

      <section className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" data-testid="forecast-table">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
              <th scope="col" className="px-3 py-2">
                Level
              </th>
              {["Target", "Won", "Committed", "Weighted pipeline", "Forecast", "Attainment", "Gap to target"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.key} className={cn("border-b border-border last:border-0", n.level === "group" && "bg-muted/50 font-semibold", n.level === "brand" && "font-semibold")} data-level={n.level}>
                <th scope="row" className={cn("py-2 pr-3 text-left font-[inherit]", INDENT[n.level])}>
                  {n.children.length && n.level !== "group" ? (
                    <Link href={href(period.key, isOpen(n) ? (n.level === "region" ? `b:${n.brandId}` : "") : n.key)} className="text-primary hover:underline" aria-expanded={isOpen(n)}>
                      {isOpen(n) ? "▾" : "▸"} {n.label}
                    </Link>
                  ) : (
                    n.label
                  )}
                  {n.adjustment ? <span className="ml-2 text-xs font-normal text-text-muted">adj. {formatMoneyCompact(n.adjustment)}</span> : null}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{n.target > 0 ? formatMoneyCompact(n.target) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoneyCompact(n.won)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoneyCompact(n.committed)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoneyCompact(n.weighted)}</td>
                <td className="px-3 py-2 text-right tabular-nums" title={formatMoney(n.forecast)}>
                  {formatMoneyCompact(n.forecast)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n.attainment === null ? "—" : `${n.attainment}%`}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", n.target > 0 && n.forecast < n.target && "text-danger")}>{n.target > 0 ? formatMoneyCompact(n.forecast - n.target) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {targetBrands.length ? (
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="target-form">
            <h2 className="mb-1 text-[13px] font-semibold">Set a target for {period.label}</h2>
            <p className="mb-3 text-xs text-text-muted">Brand target, or narrower: choose a region, and an exec for a personal target.</p>
            <ActionForm action={setTargetAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="period" value={period.key} />
              <div className="space-y-1">
                <Label htmlFor="t-brand">Brand</Label>
                <Select id="t-brand" name="brandId" required className="w-full" defaultValue={targetBrands.length === 1 ? targetBrands[0]!.id : ""}>
                  <option value="">Choose brand…</option>
                  {targetBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} – {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-region">Region</Label>
                <Select id="t-region" name="regionId" className="w-full" defaultValue="">
                  <option value="">Whole brand</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-user">Sales exec</Label>
                <Select id="t-user" name="userId" className="w-full" defaultValue="">
                  <option value="">Everyone in the brand / region</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-units">Units</Label>
                <Input id="t-units" name="units" type="number" min={0} inputMode="numeric" defaultValue={0} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-revenue">Revenue (₦)</Label>
                <Input id="t-revenue" name="revenue" type="number" min={0} step="any" inputMode="decimal" required />
              </div>
              <div className="flex items-end">
                <SubmitButton size="sm">Save target</SubmitButton>
              </div>
            </ActionForm>
          </section>
        ) : null}
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="forecast-notes">
          <h2 className="mb-2 text-[13px] font-semibold">Commit and adjustment notes</h2>
          {noteTargets.length ? (
            <ActionForm action={addForecastNoteAction} className="mb-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="period" value={period.key} />
              <div className="space-y-1">
                <Label htmlFor="n-line">Forecast line</Label>
                <NoteLine nodes={noteTargets} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="n-adjustment">Adjustment (₦, + or −)</Label>
                <Input id="n-adjustment" name="adjustment" type="number" step="any" className="w-40" />
              </div>
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="n-note">Note</Label>
                <Input id="n-note" name="note" required maxLength={1000} />
              </div>
              <SubmitButton size="sm" variant="outline">
                Add note
              </SubmitButton>
            </ActionForm>
          ) : null}
          {notes.length ? (
            <ul className="space-y-2 text-[13px]">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border border-border p-2">
                  <div>
                    <span className="font-semibold">{n.on}</span>
                    {n.adjustment !== null ? <span className={cn("ml-2", n.adjustment < 0 ? "text-danger" : "")}>{n.adjustment > 0 ? "+" : ""}{formatMoney(n.adjustment)}</span> : null}
                  </div>
                  <p>{n.note}</p>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    {n.author} · {formatDate(n.at, prefs.dateFormat)}
                    {n.mine ? (
                      <ActionForm action={deleteForecastNoteAction} confirm="Delete this note?" className="ml-auto">
                        <input type="hidden" name="id" value={n.id} />
                        <button type="submit" className="underline">
                          delete
                        </button>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-text-muted">No notes for this period{noteTargets.length ? "" : " (managers can add them)"}.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** One select that carries brand, region and user of the chosen forecast line (three hidden-less named options). */
function NoteLine({ nodes }: { nodes: ForecastNode[] }) {
  // The select posts "brandId|regionId|userId"; the action splits it server-side via the three inputs below.
  return (
    <Select id="n-line" name="line" required defaultValue="" className="w-64">
      <option value="">Choose…</option>
      {nodes.map((n) => (
        <option key={n.key} value={[n.brandId, n.regionId ?? "", n.userId ?? ""].join("|")}>
          {n.level === "brand" ? n.label : n.level === "region" ? `  ${n.label}` : `    ${n.label}`}
        </option>
      ))}
    </Select>
  );
}
