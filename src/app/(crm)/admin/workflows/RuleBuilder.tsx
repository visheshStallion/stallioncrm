"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { OP_LABELS, OPS, type Condition, type Criteria, type Op } from "@/server/automation/criteria";
import { saveRuleAction } from "@/server/modules/workflow/actions";
import { ACTION_LABELS, FUNCTIONS, TRIGGER_LABELS, WF_MODULES, type WfField } from "@/server/modules/workflow/modules";

type Action = Record<string, unknown> & { type: string };
interface Group {
  mode: "all" | "any";
  conditions: Condition[];
}
export interface RuleDraft {
  id?: string;
  name: string;
  description: string;
  module: string;
  trigger: string;
  triggerConfig: { field?: string; dateField?: string; offsetDays?: number; repeat?: string };
  brandId: string;
  criteria: Criteria;
  actions: Action[];
  active: boolean;
}

const NO_VALUE: Op[] = ["isEmpty", "notEmpty"];
const opsFor = (f?: WfField): Op[] =>
  !f
    ? [...OPS]
    : f.type === "date"
      ? ["olderThanHours", "olderThanDays", "withinDays", "isEmpty", "notEmpty"]
      : f.type === "number"
        ? ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "notEmpty"]
        : f.type === "boolean"
          ? ["eq"]
          : f.type === "enum"
            ? ["eq", "neq", "in"]
            : ["eq", "neq", "contains", "isEmpty", "notEmpty"];

/** The builder edits "all of [conditions…] and any of [conditions…]" – two groups cover AND, OR and AND-of-OR. */
function toGroups(c: Criteria): [Group, Group] {
  const flat = (nodes: Criteria["all"]) => (nodes ?? []).filter((n): n is Condition => "field" in n);
  const nestedAny = (c.all ?? []).find((n): n is Criteria => !("field" in n) && !!n.any);
  return [
    { mode: "all", conditions: flat(c.all) },
    { mode: "any", conditions: [...flat(c.any), ...flat(nestedAny?.any)] },
  ];
}
const fromGroups = ([all, any]: [Group, Group]): Criteria => ({ ...(all.conditions.length ? { all: all.conditions } : {}), ...(any.conditions.length ? { any: any.conditions } : {}) });

const NEW_ACTION: Record<string, Action> = {
  FIELD_UPDATE: { type: "FIELD_UPDATE", field: "", value: "" },
  CREATE_TASK: { type: "CREATE_TASK", subject: "", dueInHours: 24, assignee: "OWNER", priority: "NORMAL", activityType: "TASK" },
  SEND_NOTIFICATION: { type: "SEND_NOTIFICATION", to: "OWNER", title: "" },
  SEND_EMAIL: { type: "SEND_EMAIL", to: "OWNER", subject: "", body: "" },
  SEND_DOCUMENT: { type: "SEND_DOCUMENT", documentTemplate: "default", emailTemplateId: "" },
  WEBHOOK: { type: "WEBHOOK", url: "https://" },
  ASSIGN_OWNER: { type: "ASSIGN_OWNER", to: "BRAND_MANAGER" },
  CALL_FUNCTION: { type: "CALL_FUNCTION", name: FUNCTIONS[0].name },
};

/** Workflow rule builder: trigger, brand scope, criteria (AND / OR with field pickers from the module schema), actions. */
export function RuleBuilder({ initial, brands, roles, users }: { initial: RuleDraft; brands: Array<{ id: string; label: string }>; roles: string[]; users: Array<{ id: string; name: string }> }) {
  const [rule, setRule] = useState(initial);
  const [groups, setGroups] = useState<[Group, Group]>(() => toGroups(initial.criteria));
  const mod = WF_MODULES.find((m) => m.key === rule.module) ?? WF_MODULES[0]!;
  const fields = mod.fields;
  const set = (patch: Partial<RuleDraft>) => setRule((r) => ({ ...r, ...patch }));
  const setAction = (i: number, patch: Record<string, unknown>) => set({ actions: rule.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const setCondition = (g: 0 | 1, i: number, patch: Partial<Condition>) =>
    setGroups((gs) => gs.map((grp, gi) => (gi === g ? { ...grp, conditions: grp.conditions.map((c, ci) => (ci === i ? { ...c, ...patch } : c)) } : grp)) as [Group, Group]);
  const addCondition = (g: 0 | 1) =>
    setGroups((gs) => gs.map((grp, gi) => (gi === g ? { ...grp, conditions: [...grp.conditions, { field: fields[0]!.key, op: opsFor(fields[0])[0]!, value: "" }] } : grp)) as [Group, Group]);
  const removeCondition = (g: 0 | 1, i: number) => setGroups((gs) => gs.map((grp, gi) => (gi === g ? { ...grp, conditions: grp.conditions.filter((_, ci) => ci !== i) } : grp)) as [Group, Group]);

  const payload = JSON.stringify({
    name: rule.name,
    description: rule.description,
    module: rule.module,
    trigger: rule.trigger,
    triggerConfig: rule.triggerConfig,
    brandId: rule.brandId || null,
    criteria: fromGroups(groups),
    actions: rule.actions,
    active: rule.active,
  });
  const recipient = (a: Action, i: number, id: string) => (
    <>
      <Select value={String(a.to)} onChange={(e) => setAction(i, { to: e.target.value })} aria-label="Recipient" id={id}>
        <option value="OWNER">Record owner</option>
        <option value="BRAND_MANAGER">Brand Manager of the record</option>
        <option value="ROLE">Everyone with a role (who can see the record)</option>
      </Select>
      {a.to === "ROLE" ? (
        <Select value={String(a.roleName ?? "")} onChange={(e) => setAction(i, { roleName: e.target.value })} aria-label="Role">
          <option value="">Choose role…</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      ) : null}
    </>
  );
  const box = "rounded-lg border border-border bg-surface";
  const head = "border-b border-border px-4 py-2.5 text-[13px] font-semibold";

  return (
    <ActionForm action={saveRuleAction} className="space-y-4">
      {rule.id ? <input type="hidden" name="id" value={rule.id} /> : null}
      <input type="hidden" name="payload" value={payload} />

      <section className={box}>
        <h2 className={head}>Rule</h2>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={rule.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="module">Module</Label>
            <Select
              id="module"
              className="w-full"
              value={rule.module}
              onChange={(e) => {
                set({ module: e.target.value, triggerConfig: {}, actions: [] });
                setGroups([
                  { mode: "all", conditions: [] },
                  { mode: "any", conditions: [] },
                ]);
              }}
            >
              {WF_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="brandId">Brand scope</Label>
            <Select id="brandId" className="w-full" value={rule.brandId} onChange={(e) => set({ brandId: e.target.value })}>
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-text-muted">A rule scoped to a brand never touches other brands&apos; records.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={rule.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rule.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
        </div>
      </section>

      <section className={box}>
        <h2 className={head}>When</h2>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="trigger">Trigger</Label>
            <Select id="trigger" value={rule.trigger} onChange={(e) => set({ trigger: e.target.value, triggerConfig: e.target.value === "SCHEDULED" ? { repeat: "ONCE" } : {} })}>
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          {rule.trigger === "FIELD_CHANGE" ? (
            <div className="space-y-1">
              <Label htmlFor="watch">Field</Label>
              <Select id="watch" value={rule.triggerConfig.field ?? ""} onChange={(e) => set({ triggerConfig: { field: e.target.value } })}>
                <option value="">Choose field…</option>
                {fields
                  .filter((f) => f.watchable)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
              </Select>
            </div>
          ) : null}
          {rule.trigger === "DATE_BASED" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="dateField">Date field</Label>
                <Select id="dateField" value={rule.triggerConfig.dateField ?? ""} onChange={(e) => set({ triggerConfig: { ...rule.triggerConfig, dateField: e.target.value } })}>
                  <option value="">Choose field…</option>
                  {fields
                    .filter((f) => f.type === "date")
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="offsetDays">Days after (negative = before)</Label>
                <Input id="offsetDays" type="number" className="w-32" value={rule.triggerConfig.offsetDays ?? 0} onChange={(e) => set({ triggerConfig: { ...rule.triggerConfig, offsetDays: Number(e.target.value) } })} />
              </div>
            </>
          ) : null}
          {rule.trigger === "SCHEDULED" ? (
            <div className="space-y-1">
              <Label htmlFor="repeat">Run for a record</Label>
              <Select id="repeat" value={rule.triggerConfig.repeat ?? "ONCE"} onChange={(e) => set({ triggerConfig: { repeat: e.target.value } })}>
                <option value="ONCE">Once</option>
                <option value="PER_UPDATE">Again after the record was updated</option>
              </Select>
            </div>
          ) : null}
        </div>
      </section>

      <section className={box} data-testid="criteria-builder">
        <h2 className={head}>Criteria</h2>
        <div className="space-y-4 p-4">
          {([0, 1] as const).map((g) => (
            <div key={g}>
              <div className="mb-1 text-xs font-semibold uppercase text-text-muted">{g === 0 ? "All of these (AND)" : "And at least one of these (OR)"}</div>
              <ul className="space-y-2">
                {groups[g].conditions.map((c, i) => {
                  const def = fields.find((f) => f.key === c.field);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Select value={c.field} aria-label="Field" onChange={(e) => setCondition(g, i, { field: e.target.value, op: opsFor(fields.find((f) => f.key === e.target.value))[0]!, value: "" })}>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      <Select value={c.op} aria-label="Operator" onChange={(e) => setCondition(g, i, { op: e.target.value as Op })}>
                        {opsFor(def).map((o) => (
                          <option key={o} value={o}>
                            {OP_LABELS[o]}
                          </option>
                        ))}
                      </Select>
                      {NO_VALUE.includes(c.op) ? null : def?.type === "boolean" ? (
                        <Select value={String(c.value)} aria-label="Value" onChange={(e) => setCondition(g, i, { value: e.target.value === "true" })}>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </Select>
                      ) : def?.options && c.op !== "in" ? (
                        <Select value={String(c.value ?? "")} aria-label="Value" onChange={(e) => setCondition(g, i, { value: e.target.value })}>
                          <option value="">Choose…</option>
                          {def.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          className="w-48"
                          aria-label="Value"
                          type={def?.type === "number" || def?.type === "date" ? "number" : "text"}
                          value={String(c.value ?? "")}
                          placeholder={c.op === "in" ? "A,B,C" : ""}
                          onChange={(e) => setCondition(g, i, { value: def?.type === "number" || def?.type === "date" ? Number(e.target.value) : e.target.value })}
                        />
                      )}
                      <button type="button" onClick={() => removeCondition(g, i)} aria-label="Remove condition" className="text-text-muted hover:text-danger">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => addCondition(g)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
              </Button>
            </div>
          ))}
          <p className="text-xs text-text-muted">No conditions = every record of the module (not allowed for scheduled rules).</p>
        </div>
      </section>

      <section className={box} data-testid="actions-builder">
        <h2 className={head}>Then</h2>
        <div className="space-y-3 p-4">
          {rule.actions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <span className="w-40 text-[13px] font-semibold">{ACTION_LABELS[a.type]}</span>
              {a.type === "FIELD_UPDATE" ? (
                <>
                  <Select value={String(a.field)} aria-label="Field to update" onChange={(e) => setAction(i, { field: e.target.value })}>
                    <option value="">Choose field…</option>
                    {fields
                      .filter((f) => f.updatable)
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </Select>
                  <Input className="w-48" aria-label="New value" value={String(a.value ?? "")} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="New value" />
                </>
              ) : null}
              {a.type === "CREATE_TASK" ? (
                <>
                  <Input className="w-72" aria-label="Task subject" value={String(a.subject)} onChange={(e) => setAction(i, { subject: e.target.value })} placeholder="Subject – {{name}} inserts the record name" />
                  <Select value={String(a.activityType)} aria-label="Activity type" onChange={(e) => setAction(i, { activityType: e.target.value })}>
                    <option value="TASK">Task</option>
                    <option value="CALL">Call</option>
                  </Select>
                  <Input className="w-24" type="number" min={0} aria-label="Due in hours" value={Number(a.dueInHours)} onChange={(e) => setAction(i, { dueInHours: Number(e.target.value) })} />
                  <span className="text-xs text-text-muted">hours, for</span>
                  <Select value={String(a.assignee)} aria-label="Assignee" onChange={(e) => setAction(i, { assignee: e.target.value })}>
                    <option value="OWNER">Record owner</option>
                    <option value="BRAND_MANAGER">Brand Manager</option>
                  </Select>
                </>
              ) : null}
              {a.type === "SEND_NOTIFICATION" ? (
                <>
                  {recipient(a, i, `to-${i}`)}
                  <Input className="w-72" aria-label="Notification title" value={String(a.title)} onChange={(e) => setAction(i, { title: e.target.value })} placeholder="Title" />
                </>
              ) : null}
              {a.type === "SEND_EMAIL" ? (
                <>
                  {recipient(a, i, `to-${i}`)}
                  <Input className="w-56" aria-label="Email subject" value={String(a.subject)} onChange={(e) => setAction(i, { subject: e.target.value })} placeholder="Subject" />
                  <Input className="w-72" aria-label="Email body" value={String(a.body ?? "")} onChange={(e) => setAction(i, { body: e.target.value })} placeholder="Body" />
                </>
              ) : null}
              {a.type === "SEND_DOCUMENT" ? (
                <>
                  <Input className="w-64" aria-label="Document template" value={String(a.documentTemplate ?? "default")} onChange={(e) => setAction(i, { documentTemplate: e.target.value })} placeholder="default, or doc:<template id>" title="“default” uses the brand’s default document template. For one template, write doc: followed by the id in its address." />
                  <Input className="w-56" aria-label="E-mail template id (optional)" value={String(a.emailTemplateId ?? "")} onChange={(e) => setAction(i, { emailTemplateId: e.target.value })} placeholder="E-mail template id (optional)" />
                  <span className="text-xs text-text-muted">Quotes, sales orders and deals · sent as the record&apos;s owner to the customer</span>
                </>
              ) : null}
              {a.type === "WEBHOOK" ? <Input className="w-96" type="url" aria-label="Webhook URL" value={String(a.url)} onChange={(e) => setAction(i, { url: e.target.value })} placeholder="https://…" /> : null}
              {a.type === "ASSIGN_OWNER" ? (
                <>
                  <Select value={String(a.to)} aria-label="New owner" onChange={(e) => setAction(i, { to: e.target.value })}>
                    <option value="BRAND_MANAGER">Brand Manager of the record</option>
                    <option value="USER">A specific user</option>
                  </Select>
                  {a.to === "USER" ? (
                    <Select value={String(a.userId ?? "")} aria-label="User" onChange={(e) => setAction(i, { userId: e.target.value })}>
                      <option value="">Choose user…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </>
              ) : null}
              {a.type === "CALL_FUNCTION" ? (
                <Select value={String(a.name)} aria-label="Function" onChange={(e) => setAction(i, { name: e.target.value })}>
                  {FUNCTIONS.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              ) : null}
              <button type="button" onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })} aria-label="Remove action" className="ml-auto text-text-muted hover:text-danger">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Select aria-label="Add action" value="" onChange={(e) => e.target.value && set({ actions: [...rule.actions, { ...NEW_ACTION[e.target.value]! }] })}>
              <option value="">+ Add action…</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <span className="text-xs text-text-muted">Actions run as the system, inside the record&apos;s brand only.</span>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link href="/admin/workflows">Cancel</Link>
        </Button>
        <SubmitButton>Save Rule</SubmitButton>
      </div>
    </ActionForm>
  );
}
