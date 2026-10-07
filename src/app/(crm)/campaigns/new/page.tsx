import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { hasPermission } from "@/server/access/can";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { saveCampaignAction } from "@/server/modules/messaging/actions";
import { getDirectory } from "@/server/modules/org/queries";
import { listReports } from "@/server/modules/reports/service";
import { getSetting } from "@/server/modules/setup/service";
import { requireContext } from "@/server/request";
import { CampaignFields } from "../CampaignFields";

export const metadata = { title: "Create Campaign" };

/** Create Campaign (Zoho-style page): sub-header with [Cancel] [Save and New] [Save]. */
export default async function NewCampaignPage() {
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "create")) forbidden();
  const dir = await getDirectory(ctx);
  const brands = dir.myBrands.filter((b) => b.status === "ACTIVE");
  const [reports, lookups, currencies] = await Promise.all([hasPermission(ctx, "reports", "read") ? listReports(ctx) : [], productFormLookups(ctx, brands.map((b) => b.id)), getSetting("currencies")]);
  return (
    <ActionForm action={saveCampaignAction}>
      <div className="crm-po-subheader" data-testid="po-subheader">
        <div className="flex items-baseline gap-4">
          <h1>Create Campaign</h1>
          {ctx.isAdmin ? (
            <Link href="/setup/modules-fields" className="text-[13px] text-primary underline" data-testid="edit-page-layout">
              Edit Page Layout
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href="/campaigns" className="crm-btn crm-btn-secondary">
            Cancel
          </Link>
          <SubmitButton variant="outline" name="_saveAndNew" value="1">
            Save and New
          </SubmitButton>
          <SubmitButton>Save</SubmitButton>
        </div>
      </div>
      <CampaignFields
        brands={brands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))}
        templates={[]}
        reports={reports.filter((r) => !r.definition.special && (r.module === "leads" || r.module === "deals")).map((r) => ({ id: r.id, label: r.name }))}
        owners={lookups.owners}
        rates={{ NGN: 1, ...((currencies as { rates?: Record<string, number> }).rates ?? {}) }}
        userId={ctx.userId}
      />
    </ActionForm>
  );
}
