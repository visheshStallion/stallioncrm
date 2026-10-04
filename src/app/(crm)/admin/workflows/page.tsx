import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { listRules } from "@/server/db/workflow-store";
import { ACTION_LABELS, TRIGGER_LABELS, wfModule } from "@/server/modules/workflow/modules";
import { toggleRuleAction } from "@/server/modules/workflow/actions";
import { requireContext } from "@/server/request";

export const metadata = { title: "Workflow rules" };

/** Workflow rules (prompt 08, part B). The admin layout already restricts this area to administrators. */
export default async function WorkflowRulesPage() {
  if (!(await requireContext()).isAdmin) notFound();
  const rules = await listRules();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Workflow rules</h2>
        <span className="text-xs text-text-muted">{rules.length} rules</span>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/jobs">Run log</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/workflows/new">Create Rule</Link>
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" data-testid="workflow-rules">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
              <th className="px-3 py-2">Rule</th>
              <th className="px-3 py-2">Module</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Actions</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/admin/workflows/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.name}
                  </Link>
                  {r.description ? <div className="text-xs text-text-muted">{r.description}</div> : null}
                </td>
                <td className="px-3 py-2">{wfModule(r.module)?.label ?? r.module}</td>
                <td className="px-3 py-2">{TRIGGER_LABELS[r.trigger]}</td>
                <td className="px-3 py-2">{r.brand?.code ?? "All brands"}</td>
                <td className="px-3 py-2 text-text-muted">{(Array.isArray(r.actions) ? (r.actions as Array<{ type: string }>) : []).map((a) => ACTION_LABELS[a.type] ?? a.type).join(", ")}</td>
                <td className="px-3 py-2">
                  <StatusPill tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</StatusPill>
                </td>
                <td className="px-3 py-2 text-right">
                  <ActionForm action={toggleRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="active" value={String(!r.active)} />
                    <SubmitButton size="sm" variant="ghost">
                      {r.active ? "Deactivate" : "Activate"}
                    </SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
