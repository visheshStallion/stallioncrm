import Link from "next/link";
import { SetupLanding } from "@/components/crm/SetupLayout";
import { PageTitleRow } from "@/components/crm/primitives";
import { tierOf, visibleCatalogue } from "@/server/modules/setup/access";
import { pendingSetupApprovals } from "@/server/modules/setup/destructive";
import { requireContext } from "@/server/request";

export const metadata = { title: "Setup" };

const TIER_TEXT = { SA: "Super Admin – everything", ADMIN: "Administrator – everything except Super Admin functions", BRAND_ADMIN: "Brand Admin – your brand only", LIMITED: "Setup permissions of your profile", USER: "Personal settings" } as const;

/** Setup home: the catalogue by category (only what this user may open), search and recently visited. */
export default async function SetupHome() {
  const ctx = await requireContext();
  const pending = await pendingSetupApprovals(ctx);
  return (
    <div>
      <PageTitleRow title="Setup" left={<span className="text-sm text-text-muted" data-testid="setup-tier">{TIER_TEXT[tierOf(ctx)]}</span>} />
      {pending ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="setup-pending">
          {pending} destructive operation(s) wait for a second Super Admin.{" "}
          <Link href="/setup/approvals" className="font-bold text-primary underline">
            Two-person approvals
          </Link>
        </p>
      ) : null}
      <SetupLanding categories={visibleCatalogue(ctx)} />
    </div>
  );
}
