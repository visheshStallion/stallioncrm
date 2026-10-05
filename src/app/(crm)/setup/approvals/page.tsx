import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill, type Tone } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { cancelApprovalAction, decideApprovalAction } from "@/server/modules/setup/actions";
import { approvalsPageData } from "@/server/modules/setup/destructive";
import { requireSetup } from "../guard";
import { ReauthFields, Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "Two-person approvals" };

const TONE: Record<string, Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral", EXPIRED: "neutral" };

export default async function SetupApprovalsPage() {
  const { ctx, entry } = await requireSetup("setup-approvals"); // setupPermission: SA
  const rows = await approvalsPageData(ctx);
  const pending = rows.filter((r) => r.status === "PENDING");
  const done = rows.filter((r) => r.status !== "PENDING");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section
        title={`Waiting for a decision (${pending.length})`}
        hint="A destructive operation is requested by one Super Admin and carried out only when a second Super Admin approves it. Both confirm with their password. Requests expire after 72 hours."
        testId="approvals-pending"
      >
        {pending.length === 0 ? <p className="text-text-muted">Nothing is waiting.</p> : null}
        <ul className="divide-y divide-border">
          {pending.map((r) => (
            <li key={r.id} className="space-y-2 py-3" data-testid="approval-request">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="warning">Waiting</StatusPill>
                <span className="font-bold">{r.label}</span>
                <span className="ml-auto text-xs text-text-muted">
                  requested by {r.requestedBy} · {fmtDateTime(r.requestedAt)} · expires {fmtDateTime(r.expiresAt)}
                </span>
              </div>
              <p>{r.summary}</p>
              {r.mine ? (
                <ActionForm action={cancelApprovalAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <p className="mb-2 text-xs text-text-muted">You requested this: another Super Admin must decide.</p>
                  <Button size="sm" variant="outline" type="submit">
                    Withdraw the request
                  </Button>
                </ActionForm>
              ) : (
                // the field is not called "id": a control named "id" shadows form.id, and React then loses the value of the clicked button
                <ActionForm action={decideApprovalAction} className="space-y-2">
                  <input type="hidden" name="requestId" value={r.id} />
                  <ReauthFields id={`decide-${r.id}`} note="Confirm it is you. Approving carries the operation out immediately." />
                  <div className="flex gap-2">
                    <SubmitButton size="sm" name="decision" value="approve">
                      Approve and carry out
                    </SubmitButton>
                    <SubmitButton size="sm" variant="outline" name="decision" value="reject">
                      Reject
                    </SubmitButton>
                  </div>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Decided" testId="approvals-history">
        {done.length === 0 ? <p className="text-text-muted">No decisions yet.</p> : null}
        <ul className="divide-y divide-border">
          {done.map((r) => (
            <li key={r.id} className="py-2" data-testid="approval-decided">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</StatusPill>
                <span className="font-bold">{r.label}</span>
                <span className="ml-auto text-xs text-text-muted">
                  requested by {r.requestedBy}
                  {r.decidedBy ? ` · decided by ${r.decidedBy} · ${fmtDateTime(r.decidedAt)}` : ""}
                </span>
              </div>
              <p className="text-text-muted">{r.summary}</p>
              {r.result ? <code className="block truncate rounded bg-surface-alt px-1.5 py-0.5 text-xs">{JSON.stringify(r.result)}</code> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
