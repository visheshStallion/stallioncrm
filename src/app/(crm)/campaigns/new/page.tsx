import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { StickyFormFooter } from "@/components/crm/record";
import { hasPermission } from "@/server/access/can";
import { saveCampaignAction } from "@/server/modules/messaging/actions";
import { getDirectory } from "@/server/modules/org/queries";
import { listReports } from "@/server/modules/reports/service";
import { requireContext } from "@/server/request";
import { CampaignFields } from "../CampaignFields";

export const metadata = { title: "Create Campaign" };

export default async function NewCampaignPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "create")) forbidden();
  const [dir, reports] = await Promise.all([getDirectory(ctx), hasPermission(ctx, "reports", "read") ? listReports(ctx) : []]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageTitleRow title="Create Campaign" />
      <ActionForm action={saveCampaignAction} className="space-y-4">
        <CampaignFields
          brands={dir.myBrands.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
          templates={[]}
          reports={reports.filter((r) => !r.definition.special && (r.module === "leads" || r.module === "deals")).map((r) => ({ id: r.id, label: r.name }))}
        />
        <p className="text-xs text-text-muted">The template is chosen on the next page, once the brand and channel are fixed.</p>
        <StickyFormFooter cancelHref="/campaigns">
          <SubmitButton>Save</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
