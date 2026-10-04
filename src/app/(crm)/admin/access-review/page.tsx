import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { assertAdmin } from "@/server/modules/admin/guard";
import { getPreferences } from "@/server/modules/preferences/queries";
import { resetUserSignInAction } from "@/server/modules/security/actions";
import { INACTIVE_DAYS, accessReview } from "@/server/modules/security/service";
import { requireContext } from "@/server/request";

export const metadata = { title: "Access review" };

/** Quarterly access review: who can see which brands and regions, when they last signed in. Administrators only. */
export default async function AccessReviewPage({ searchParams }: { searchParams: Promise<{ flagged?: string }> }) {
  const { flagged } = await searchParams;
  const ctx = await requireContext();
  assertAdmin(ctx);
  const [all, prefs] = await Promise.all([accessReview(ctx), getPreferences(ctx)]);
  const rows = flagged === "1" ? all.filter((r) => r.flags.length) : all;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Access review</h2>
        <span className="text-[13px] text-text-muted">
          {all.filter((r) => r.active).length} active · {all.filter((r) => !r.active).length} inactive · {all.filter((r) => r.flags.length).length} to look at
        </span>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={flagged === "1" ? "/admin/access-review" : "/admin/access-review?flagged=1"}>{flagged === "1" ? "Show everyone" : "Only flagged"}</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- an API download, not a page */}
            <a href="/api/v1/admin/access-review">Export CSV</a>
          </Button>
        </div>
      </div>
      <p className="text-xs text-text-muted">Run this every quarter with each Brand Manager: confirm every user still needs the brands and regions listed, deactivate leavers, and look at accounts without a sign-in for {INACTIVE_DAYS} days. Opening this page is recorded in the audit log.</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" data-testid="access-review">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role / profile</th>
              <th className="px-3 py-2">Brands</th>
              <th className="px-3 py-2">Regions</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Sign-in</th>
              <th className="px-3 py-2">Review</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border align-top last:border-0" data-testid="data-row">
                <td className="px-3 py-2">
                  <a href={`/admin/users/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.name}
                  </a>
                  <div className="text-xs text-text-muted">
                    {r.email}
                    {r.kind === "integration" ? " · integration" : ""}
                    {r.active ? "" : " · inactive"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {r.role}
                  <div className="text-xs text-text-muted">{r.profile}</div>
                </td>
                <td className="px-3 py-2">{r.brands.join(", ") || "—"}</td>
                <td className="px-3 py-2">{r.regions.join(", ") || "—"}</td>
                <td className="px-3 py-2">{r.lastLoginAt ? `${formatDate(r.lastLoginAt, prefs.dateFormat)} (${r.daysSinceLogin} d)` : "never"}</td>
                <td className="px-3 py-2">
                  {r.twoStep ? <StatusPill tone="success">two-step</StatusPill> : null}
                  {r.locked ? <StatusPill tone="danger">locked</StatusPill> : null}
                </td>
                <td className="px-3 py-2">{r.flags.length ? r.flags.join("; ") : ""}</td>
                <td className="px-3 py-2 text-right">
                  {r.twoStep || r.locked ? (
                    <ActionForm action={resetUserSignInAction} confirm={`Reset two-step sign-in and unlock ${r.name}?`}>
                      <input type="hidden" name="userId" value={r.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Reset sign-in
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
