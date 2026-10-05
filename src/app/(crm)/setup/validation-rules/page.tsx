import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteValidationRuleAction, saveValidationRuleAction } from "@/server/modules/setup/actions";
import { EXPRESSION_FUNCTIONS } from "@/server/modules/setup/expression";
import { RULE_MODULES, brandsInSetupScope, listValidationRules, ruleFields } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Validation Rules" };

export default async function ValidationRulesPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { ctx, entry } = await requireSetup("validation-rules"); // setupPermission: ADMIN (delegable)
  const sp = await searchParams;
  const moduleKey = RULE_MODULES.some((m) => m.key === sp.module) ? sp.module! : RULE_MODULES[0]!.key;
  const [rules, brands] = await Promise.all([listValidationRules(ctx), brandsInSetupScope(ctx, "validation-rules")]);
  const label = (key: string) => RULE_MODULES.find((m) => m.key === key)?.label ?? key;
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title={`${rules.length} rule(s)`} hint="A rule refuses a save – in the screens, the API and imports – when its formula is true for the record, and shows your message." testId="validation-rules">
        {rules.length === 0 ? <p className="text-text-muted">No validation rules yet.</p> : null}
        <ul className="divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="validation-rule">
              <StatusPill tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Off"}</StatusPill>
              <span className="font-bold">{r.name}</span>
              <span className="text-text-muted">{label(r.module)}</span>
              {r.brand ? <BrandBadge brand={{ code: r.brand.code }} /> : <span className="text-xs text-text-muted">all brands</span>}
              <code className="rounded bg-surface-alt px-1.5 py-0.5 text-xs">{r.expression}</code>
              <span className="text-text-muted">→ “{r.message}”</span>
              <ActionForm action={deleteValidationRuleAction} className="ml-auto" confirm={`Delete the rule "${r.name}"?`}>
                <input type="hidden" name="id" value={r.id} />
                <Button size="sm" variant="ghost" type="submit">
                  Delete
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="New rule" testId="validation-rule-form">
        <form method="get" className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="pick-module">Module</Label>
            <Select id="pick-module" name="module" defaultValue={moduleKey} className="w-56">
              {RULE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline">
            Show its fields
          </Button>
        </form>
        <ActionForm action={saveValidationRuleAction} className="space-y-3">
          <input type="hidden" name="module" value={moduleKey} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Rule name</Label>
              <Input id="name" name="name" required maxLength={80} placeholder="Finance bank needed above ₦50m" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="brandId">Brand</Label>
              <Select id="brandId" name="brandId" className="w-full" defaultValue="">
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} – {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="expression">Refuse the save when this is true ({label(moduleKey)})</Label>
              <Input id="expression" name="expression" required maxLength={500} className="font-mono" placeholder='amount > 50000000 && isBlank(financeBank)' />
              <p className="text-xs text-text-muted">
                Fields: {ruleFields(moduleKey).join(", ")}. Functions: {EXPRESSION_FUNCTIONS.map((f) => `${f}()`).join(", ")}. Operators: == != &gt; &gt;= &lt; &lt;= + - * / &amp;&amp; || !
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="message">Error message shown to the user</Label>
              <Input id="message" name="message" required maxLength={200} placeholder="Deals above ₦50m need a finance bank" />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked /> Active
          </label>
          <div className="flex justify-end gap-2">
            <SubmitButton variant="outline" name="_intent" value="preview">
              Preview impact
            </SubmitButton>
            <SubmitButton name="_intent" value="save">
              Save rule
            </SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
