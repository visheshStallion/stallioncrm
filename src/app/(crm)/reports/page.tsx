import Link from "next/link";
import { forbidden } from "next/navigation";
import { BrandBadge } from "@/components/BrandBadge";
import { EmptyState, PageTitleRow } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/server/access/can";
import { getDirectory } from "@/server/modules/org/queries";
import { reportModule } from "@/server/modules/reports/catalog";
import { listReports, type ReportRow } from "@/server/modules/reports/service";
import { requireContext } from "@/server/request";

export const metadata = { title: "Reports" };

/** Report folders: standard reports, the viewer's private reports, brand folders and the group folder. */
export default async function ReportsPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "reports", "read")) forbidden();
  const [reports, dir] = await Promise.all([listReports(ctx), getDirectory(ctx)]);
  const folders: Array<{ key: string; title: string; hint: string; rows: ReportRow[] }> = [
    { key: "standard", title: "Standard reports", hint: "Ready-made reports – they show the data you are allowed to see.", rows: reports.filter((r) => r.standard) },
    { key: "private", title: "My reports (private)", hint: "Only you can open these.", rows: reports.filter((r) => r.mine && r.folder === "PRIVATE") },
    { key: "brand", title: "Brand folders", hint: "Shared with the users of one brand.", rows: reports.filter((r) => !r.standard && r.folder === "BRAND") },
    { key: "group", title: "Group folder", hint: "Shared with everyone.", rows: reports.filter((r) => !r.standard && r.folder === "GROUP") },
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="Reports"
        actions={
          hasPermission(ctx, "reports", "create") ? (
            <Button asChild>
              <Link href="/reports/new" data-shortcut="create">
                Create Report
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="space-y-4">
        {folders.map((f) => (
          <section key={f.key} className="rounded-lg border border-border bg-surface" data-testid={`folder-${f.key}`}>
            <header className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">{f.title}</h2>
              <span className="text-xs text-text-muted">{f.hint}</span>
            </header>
            {f.rows.length === 0 ? (
              <EmptyState title="No reports in this folder" />
            ) : (
              <ul className="divide-y divide-border">
                {f.rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <Link href={`/reports/${r.key ?? r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                    {r.folder === "BRAND" ? <BrandBadge brand={dir.brands.find((b) => b.id === r.brandId)} /> : null}
                    <span className="min-w-0 flex-1 truncate text-text-muted">{r.description}</span>
                    <span className="text-xs text-text-muted">{reportModule(r.module)?.label}</span>
                    {r.standard ? null : <span className="w-40 truncate text-right text-xs text-text-muted">{r.mine ? "me" : r.ownerName}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
