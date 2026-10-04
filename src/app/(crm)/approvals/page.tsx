import Link from "next/link";
import { BrandBadge } from "@/components/BrandBadge";
import { EmptyState, PageTitleRow, StatusPill, type Tone } from "@/components/crm/primitives";
import { DetailTabs } from "@/components/crm/record";
import { DecisionForm } from "@/components/crm/RecordApprovals";
import { formatDateTime } from "@/lib/format";
import { KIND_LABELS, myApprovalTasks, mySubmittedApprovals, STATUS_LABELS } from "@/server/modules/approvals/service";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "My Approvals" };

const tone = (s: string): Tone => (s === "APPROVED" ? "success" : s === "REJECTED" ? "danger" : s === "PENDING" ? "warning" : "neutral");

/**
 * "My Approvals" inbox (prompt 08). Shows only the viewer's own tasks and requests – an approver never sees
 * requests of brands they do not manage (enforced by RLS on ApprovalTask).
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const ctx = await requireContext();
  const current = tab === "decided" || tab === "submitted" ? tab : "pending";
  const [dir, prefs, tasks, submitted] = await Promise.all([
    getDirectory(ctx),
    getPreferences(ctx),
    current === "submitted" ? [] : myApprovalTasks(ctx, current === "decided" ? "DECIDED" : "PENDING"),
    current === "submitted" ? mySubmittedApprovals(ctx) : [],
  ]);
  const brand = (id: string) => dir.brands.find((b) => b.id === id);
  const df = prefs.dateFormat;

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow title="My Approvals" />
      <DetailTabs
        current={current}
        tabs={[
          { key: "pending", label: "Waiting for me", href: "/approvals" },
          { key: "decided", label: "Decided by me", href: "/approvals?tab=decided" },
          { key: "submitted", label: "Submitted by me", href: "/approvals?tab=submitted" },
        ]}
      />
      {current !== "submitted" ? (
        tasks.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState title={current === "pending" ? "No approvals waiting for you" : "Nothing decided yet"} />
          </div>
        ) : (
          <ul className="space-y-3" data-testid="approval-inbox">
            {tasks.map((t) => (
              <li key={t.taskId} className="rounded-lg border border-border bg-surface p-4" data-testid="approval-task">
                <div className="flex flex-wrap items-center gap-2">
                  <BrandBadge brand={brand(t.brandId)} />
                  <span className="text-xs font-semibold uppercase text-text-muted">{KIND_LABELS[t.kind] ?? t.kind}</span>
                  {current === "decided" ? <StatusPill tone={tone(t.status)}>{STATUS_LABELS[t.status]}</StatusPill> : null}
                  <span className="ml-auto text-xs text-text-muted">{formatDateTime(t.at, df)}</span>
                </div>
                <div className="mt-1 font-medium">
                  {t.href ? (
                    <Link href={t.href} className="text-primary hover:underline">
                      {t.title}
                    </Link>
                  ) : (
                    t.title
                  )}
                </div>
                <div className="text-[13px] text-text-muted">
                  Requested by {t.requesterName}
                  {t.summary ? ` · ${t.summary}` : ""}
                </div>
                {current === "pending" ? <DecisionForm requestId={t.requestId} /> : t.note ? <div className="mt-1 text-[13px]">“{t.note}”</div> : null}
              </li>
            ))}
          </ul>
        )
      ) : submitted.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="You have not submitted anything for approval" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="approval-submitted">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">Decision</th>
              </tr>
            </thead>
            <tbody>
              {submitted.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    {r.href ? (
                      <Link href={r.href} className="font-medium text-primary hover:underline">
                        {r.title || r.entity}
                      </Link>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td className="px-3 py-2">{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={tone(r.status)}>{STATUS_LABELS[r.status]}</StatusPill>
                  </td>
                  <td className="px-3 py-2">{formatDateTime(r.at, df)}</td>
                  <td className="px-3 py-2 text-text-muted">{r.decidedAt ? `${formatDateTime(r.decidedAt, df)}${r.decisionNote ? ` · ${r.decisionNote}` : ""}` : r.approverName ? `Waiting for ${r.approverName}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
