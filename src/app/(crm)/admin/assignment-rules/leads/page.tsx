import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { scopedDb } from "@/server/db";
import { adminLookups } from "@/server/modules/admin/queries";
import {
  createRuleAction,
  deleteRuleAction,
  moveRuleAction,
  updateRuleAction,
} from "@/server/modules/leads/actions";
import { listRules } from "@/server/modules/leads/assignment-admin";
import { LEAD_SOURCES, SOURCE_LABELS } from "@/server/modules/leads/schema";
import { requireContext } from "@/server/request";

export const metadata = { title: "Lead assignment rules" };

const ACTION_LABELS = {
  ROUND_ROBIN: "Round-robin in Brand–Region territory",
  SPECIFIC_USER: "Specific user",
  TERRITORY_MANAGER: "Territory manager",
} as const;

type Lookups = Awaited<ReturnType<typeof adminLookups>> & { products: Array<{ id: string; name: string }> };
type RuleValues = Partial<{
  id: string;
  name: string;
  active: boolean;
  brandId: string | null;
  regionId: string | null;
  source: string | null;
  productId: string | null;
  action: string;
  userId: string | null;
}>;

function RuleFields({ lookups, v = {} }: { lookups: Lookups; v?: RuleValues }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input name="name" defaultValue={v.name} placeholder="Rule name" required className="w-48" aria-label="Rule name" />
      <span className="text-muted-foreground">if</span>
      <Select name="brandId" defaultValue={v.brandId ?? ""} aria-label="Brand">
        <option value="">any brand</option>
        {lookups.brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code}
          </option>
        ))}
      </Select>
      <Select name="regionId" defaultValue={v.regionId ?? ""} aria-label="Region">
        <option value="">any region</option>
        {lookups.regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Select name="source" defaultValue={v.source ?? ""} aria-label="Source">
        <option value="">any source</option>
        {LEAD_SOURCES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select name="productId" defaultValue={v.productId ?? ""} aria-label="Model">
        <option value="">any model</option>
        {lookups.products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <span className="text-muted-foreground">→</span>
      <Select name="action" defaultValue={v.action ?? "ROUND_ROBIN"} aria-label="Action">
        {Object.entries(ACTION_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      <Select name="userId" defaultValue={v.userId ?? ""} aria-label="User (for specific user)">
        <option value="">(user)</option>
        {lookups.activeUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1">
        <input type="checkbox" name="active" defaultChecked={v.active ?? true} /> active
      </label>
    </div>
  );
}

export default async function AssignmentRulesPage() {
  const ctx = await requireContext();
  const [rules, base, products] = await Promise.all([
    listRules(ctx),
    adminLookups(ctx),
    scopedDb(ctx).product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const lookups: Lookups = { ...base, products };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Lead assignment rules</CardTitle>
          <CardDescription>
            Evaluated top to bottom; the first active matching rule assigns the owner. Inactive users are skipped. If a rule
            finds nobody, the lead goes round-robin in its Brand–Region territory, then to the territory manager, then to the
            Brand Manager. Round-robin position is stored per rule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.map((r, i) => (
            <div key={r.id} className="rounded-md border border-border p-3" data-testid="assignment-rule">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold">#{i + 1}</span>
                <span>pointer {r.rrPointer}</span>
                <ActionForm action={moveRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="direction" value="up" />
                  <Button size="sm" variant="ghost" type="submit" disabled={i === 0} aria-label="Move up">
                    ↑
                  </Button>
                </ActionForm>
                <ActionForm action={moveRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="direction" value="down" />
                  <Button size="sm" variant="ghost" type="submit" disabled={i === rules.length - 1} aria-label="Move down">
                    ↓
                  </Button>
                </ActionForm>
                <ActionForm action={deleteRuleAction} confirm={`Delete rule "${r.name}"?`} className="ml-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <Button size="sm" variant="ghost" type="submit">
                    Delete
                  </Button>
                </ActionForm>
              </div>
              <ActionForm action={updateRuleAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={r.id} />
                <RuleFields lookups={lookups} v={r} />
                <SubmitButton size="sm" variant="outline">
                  Save
                </SubmitButton>
              </ActionForm>
            </div>
          ))}
          {rules.length === 0 ? <p className="text-sm text-muted-foreground">No rules – the fallback chain applies.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New rule</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRuleAction} className="flex flex-wrap items-center gap-2">
            <RuleFields lookups={lookups} />
            <SubmitButton size="sm">Add rule</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
