import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { listApprovalProcesses } from "@/server/db/approval-engine";
import { updateApprovalProcessAction } from "@/server/modules/approvals/actions";
import { requireContext } from "@/server/request";

export const metadata = { title: "Approval processes" };

const APPROVER: Record<string, string> = {
  BRAND_MANAGER_OF_RECORD: "Brand Manager of the record's brand",
  BRAND_MANAGER_OF_NEW_BRAND: "Brand Manager of the NEW brand",
  ROLE: "Role",
  USER: "User",
  RSM: "Regional Sales Manager of the region",
};

/** Approval processes and their steps (prompt 08, part A). Discount thresholds are set per brand in Brands. */
export default async function ApprovalProcessesPage() {
  if (!(await requireContext()).isAdmin) notFound();
  const processes = await listApprovalProcesses();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Approval processes</h2>
        <span className="text-xs text-text-muted">
          Discount thresholds (A → Brand Manager, B → Head of Sales) are set per brand in{" "}
          <Link href="/admin/brands" className="text-primary hover:underline">
            Brands
          </Link>
          .
        </span>
      </div>
      {processes.map((p) => {
        const orders = [...new Set(p.steps.map((s) => s.order))];
        return (
          <ActionForm key={p.id} action={updateApprovalProcessAction} className="rounded-lg border border-border bg-surface" >
            <input type="hidden" name="id" value={p.id} />
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">{p.name}</h3>
              <span className="text-xs text-text-muted">
                {p.module === "*" ? "Leads and deals" : p.module} · {p.brand?.code ?? "all brands"}
              </span>
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={p.active} /> Active
              </label>
            </div>
            <ol className="space-y-2 p-4 text-[13px]" data-testid={`process-${p.key}`}>
              {orders.map((order) => {
                const steps = p.steps.filter((s) => s.order === order);
                const slots = [...new Set(steps.map((s) => s.slot ?? s.id))];
                return (
                  <li key={order}>
                    <span className="font-semibold">Step {order}</span>
                    {slots.length > 1 ? <span className="text-text-muted"> – all of (in parallel):</span> : null}
                    <ul className="ml-4 list-disc">
                      {slots.map((slot) => {
                        const alt = steps.filter((s) => (s.slot ?? s.id) === slot);
                        return (
                          <li key={slot} className="py-0.5">
                            {alt.map((s) => `${APPROVER[s.approverType]}${s.roleName ? `: ${s.roleName}` : ""}`).join("  or  ")}
                            {alt[0]!.condition ? <span className="text-text-muted"> (only when the discount is above threshold B)</span> : null}
                            <span className="ml-3 inline-flex items-center gap-1 text-xs text-text-muted">
                              auto-approve after
                              <Input name={`auto:${alt[0]!.id}`} type="number" min={0} max={1440} defaultValue={alt[0]!.autoApproveAfterHours ?? ""} className="h-7 w-20" aria-label={`Auto-approve hours, step ${order}`} />
                              hours (empty = never)
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
            <div className="border-t border-border px-4 py-2 text-right">
              <SubmitButton size="sm" variant="outline">
                Save
              </SubmitButton>
            </div>
          </ActionForm>
        );
      })}
    </div>
  );
}
