import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import type { Criteria } from "@/server/automation/criteria";
import { scopedDb } from "@/server/db";
import { getRule } from "@/server/db/workflow-store";
import { deleteRuleAction } from "@/server/modules/workflow/actions";
import { requireContext } from "@/server/request";
import { RuleBuilder, type RuleDraft } from "../RuleBuilder";

export const metadata = { title: "Workflow rule" };

const EMPTY: RuleDraft = { name: "", description: "", module: "deals", trigger: "ON_CREATE", triggerConfig: {}, brandId: "", criteria: {}, actions: [], active: true };

/** Create (`/admin/workflows/new`) or edit a workflow rule. */
export default async function WorkflowRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.isAdmin) notFound();
  const db = scopedDb(ctx);
  const [rule, brands, roles, users] = await Promise.all([
    id === "new" ? null : getRule(id),
    db.brand.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.role.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (id !== "new" && !rule) notFound();
  const initial: RuleDraft = rule
    ? {
        id: rule.id,
        name: rule.name,
        description: rule.description ?? "",
        module: rule.module,
        trigger: rule.trigger,
        triggerConfig: (rule.triggerConfig ?? {}) as RuleDraft["triggerConfig"],
        brandId: rule.brandId ?? "",
        criteria: (rule.criteria ?? {}) as Criteria,
        actions: (Array.isArray(rule.actions) ? rule.actions : []) as RuleDraft["actions"],
        active: rule.active,
      }
    : EMPTY;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/admin/workflows" className="text-sm text-primary hover:underline">
          ← Workflow rules
        </Link>
        <h2 className="text-base font-semibold">{rule ? rule.name : "New workflow rule"}</h2>
        {rule ? (
          <ActionForm action={deleteRuleAction} confirm="Delete this rule?" className="ml-auto">
            <input type="hidden" name="id" value={rule.id} />
            <SubmitButton size="sm" variant="ghost">
              Delete
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
      <RuleBuilder key={initial.id ?? "new"} initial={initial} brands={brands.map((b) => ({ id: b.id, label: `${b.code} – ${b.name}` }))} roles={roles.map((r) => r.name)} users={users} />
    </div>
  );
}
