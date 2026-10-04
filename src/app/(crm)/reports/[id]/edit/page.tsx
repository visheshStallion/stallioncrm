import { forbidden, notFound } from "next/navigation";
import { PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { getDirectory } from "@/server/modules/org/queries";
import { getReport } from "@/server/modules/reports/service";
import { requireContext } from "@/server/request";
import { toDraft } from "../../draft";
import { ReportBuilder } from "../../ReportBuilder";

export const metadata = { title: "Edit Report" };

/** Only the owner edits a report (standard and shared reports: "Save a copy"). */
export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "reports", "edit")) forbidden();
  const report = await getReport(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  if (!report.mine) forbidden();
  const dir = await getDirectory(ctx);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title={`Edit: ${report.name}`} />
      <ReportBuilder key={report.id} initial={toDraft(report)} brands={dir.myBrands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))} />
    </div>
  );
}
