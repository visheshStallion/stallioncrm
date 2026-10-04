import { forbidden } from "next/navigation";
import { PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";
import { toDraft } from "../draft";
import { ReportBuilder } from "../ReportBuilder";

export const metadata = { title: "Create Report" };

export default async function NewReportPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "reports", "create")) forbidden();
  const dir = await getDirectory(ctx);
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="Create Report" />
      <ReportBuilder initial={toDraft()} brands={dir.myBrands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))} />
    </div>
  );
}
