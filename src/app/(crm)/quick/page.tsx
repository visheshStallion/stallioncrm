import { PageTitleRow } from "@/components/crm/primitives";
import { QuickActions } from "@/components/pwa/QuickActions";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Quick actions" };

/** Field quick actions (log a call, add a note, new lead) – they also work without a connection. */
export default async function QuickPage() {
  const ctx = await requireContext();
  const dir = await getDirectory(ctx);
  return (
    <div>
      <PageTitleRow title="Quick actions" />
      <QuickActions brands={dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code }))} regions={dir.myRegions.map((r) => ({ id: r.id, name: r.name }))} />
    </div>
  );
}
