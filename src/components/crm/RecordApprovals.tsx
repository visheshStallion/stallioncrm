import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime, type DateFormat } from "@/lib/format";
import { decideApprovalFormAction, recallApprovalAction, requestBrandChangeAction, requestOwnerTransferAction } from "@/server/modules/approvals/actions";
import { KIND_LABELS, type RecordApproval } from "@/server/modules/approvals/service";
import { ApprovalBanner } from "./primitives";

/** Approve / reject with an optional comment. */
export function DecisionForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={decideApprovalFormAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Input name="note" placeholder="Comment (optional)" maxLength={1000} className="h-8 w-64" aria-label="Decision comment" />
      <SubmitButton size="sm" name="decision" value="approve">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="outline" name="decision" value="reject">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

/** Pending approvals of a record: who is asked, the comment trail, approve / reject / recall. */
export function PendingApprovals({ approvals, dateFormat }: { approvals: RecordApproval[]; dateFormat: DateFormat }) {
  if (approvals.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {approvals.map((a) => (
        <ApprovalBanner key={a.id}>
          <div className="font-semibold">
            {KIND_LABELS[a.kind] ?? "Approval"} pending – this record is locked until it is decided
          </div>
          <div>{a.title}</div>
          <div className="text-xs text-text-muted">
            Requested by {a.requestedBy} on {formatDateTime(a.at, dateFormat)}
            {a.reason ? ` · ${a.reason}` : ""} · waiting for {a.waitingFor.join(" and ") || "an approver"}
          </div>
          {a.canDecide ? <DecisionForm requestId={a.id} /> : null}
          {a.canRecall ? (
            <ActionForm action={recallApprovalAction} confirm="Recall this request?" className="mt-2">
              <input type="hidden" name="requestId" value={a.id} />
              <SubmitButton size="sm" variant="ghost">
                Recall request
              </SubmitButton>
            </ActionForm>
          ) : null}
        </ApprovalBanner>
      ))}
    </div>
  );
}

/**
 * "Move record": request a brand change (approved by the Brand Managers of the old and the new brand) or a
 * transfer to another region (approved by the RSM or the Brand Manager).
 */
export function MoveRecordCard({
  entity,
  id,
  brands,
  regions,
  users,
}: {
  entity: "Lead" | "Deal";
  id: string;
  /** other active brands */
  brands: Array<{ id: string; label: string }>;
  /** other regions */
  regions: Array<{ id: string; label: string }>;
  users: Array<{ id: string; name: string }>;
}) {
  const field = "space-y-1";
  return (
    <details className="rounded-lg border border-border bg-surface" data-testid="move-record">
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold">Change brand or transfer to another region</summary>
      <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
        <ActionForm action={requestBrandChangeAction} className="space-y-2" confirm="Send the brand change for approval? The record is locked until both Brand Managers have decided.">
          <h3 className="text-[13px] font-semibold">Brand change</h3>
          <p className="text-xs text-text-muted">Needs the Brand Managers of the current and the new brand. Model, reserved vehicle and quote prices do not carry over.</p>
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="id" value={id} />
          <div className={field}>
            <Label htmlFor="newBrandId">New brand</Label>
            <Select id="newBrandId" name="newBrandId" required className="w-full" defaultValue="">
              <option value="">Choose brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </div>
          <div className={field}>
            <Label htmlFor="bc-owner">New owner (only when the owner does not work for the new brand)</Label>
            <Select id="bc-owner" name="newOwnerId" className="w-full" defaultValue="">
              <option value="">Keep the current owner</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div className={field}>
            <Label htmlFor="bc-reason">Reason</Label>
            <Input id="bc-reason" name="reason" maxLength={500} required />
          </div>
          <SubmitButton size="sm" variant="outline">
            Request brand change
          </SubmitButton>
        </ActionForm>
        <ActionForm action={requestOwnerTransferAction} className="space-y-2">
          <h3 className="text-[13px] font-semibold">Transfer to another region</h3>
          <p className="text-xs text-text-muted">Approved by the Regional Sales Manager or the Brand Manager.</p>
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="id" value={id} />
          <div className={field}>
            <Label htmlFor="newRegionId">New region</Label>
            <Select id="newRegionId" name="newRegionId" required className="w-full" defaultValue="">
              <option value="">Choose region…</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div className={field}>
            <Label htmlFor="ot-owner">New owner</Label>
            <Select id="ot-owner" name="newOwnerId" required className="w-full" defaultValue="">
              <option value="">Choose owner…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div className={field}>
            <Label htmlFor="ot-reason">Reason</Label>
            <Input id="ot-reason" name="reason" maxLength={500} required />
          </div>
          <SubmitButton size="sm" variant="outline">
            Request transfer
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
