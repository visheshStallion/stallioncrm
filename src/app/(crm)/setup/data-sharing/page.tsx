import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteSharingRuleAction, saveSharingRuleAction } from "@/server/modules/setup/actions";
import { sharingPageData } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Data Sharing Settings" };

export default async function DataSharingPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { ctx, entry } = await requireSetup("data-sharing"); // setupPermission: ADMIN
  const sp = await searchParams;
  const targetType = sp.target === "TERRITORY" || sp.target === "USER" ? sp.target : "ROLE";
  const { rules, territories, roles, modules } = await sharingPageData(ctx);
  const territoryName = (id: string) => territories.find((t) => t.id === id)?.name ?? id;
  const targetName = (type: string, id: string) => (type === "ROLE" ? (roles.find((r) => r.id === id)?.name ?? id) : type === "TERRITORY" ? territoryName(id) : "one user");
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Default access per module" hint="How a record is visible before any sharing rule." testId="sharing-defaults">
        <p>
          Every module is <strong>Private by territory</strong>: a user sees a record when they own it, or when one of their territories covers its brand and region (a brand-level membership covers every region of the brand). Profiles with the
          scope “All” (Management, Administrator) see every brand. This default is the brand isolation rule and cannot be loosened here.
        </p>
      </Section>

      <Section title={`${rules.length} sharing rule(s)`} testId="sharing-rules">
        {rules.length === 0 ? <p className="text-text-muted">No sharing rules.</p> : null}
        <ul className="divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="sharing-rule">
              <span className="font-bold">{r.name}</span>
              <span>
                {modules.find((m) => m.key === r.module)?.label ?? r.module} of {territoryName(r.sourceTerritoryId)} → {r.targetType.toLowerCase()} {targetName(r.targetType, r.targetId)} ({r.access === "READ" ? "read-only" : "read and write"})
              </span>
              <ActionForm action={deleteSharingRuleAction} className="ml-auto" confirm={`Delete the rule "${r.name}"?`}>
                <input type="hidden" name="id" value={r.id} />
                <Button size="sm" variant="ghost" type="submit">
                  Delete
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="New sharing rule" hint="A rule shares the records of one territory with a role, another territory or one user. It is refused when any of those people does not already work in the territory's brand." testId="sharing-rule-form">
        <form method="get" className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="pick-target">Share with a…</Label>
            <Select id="pick-target" name="target" defaultValue={targetType} className="w-48">
              <option value="ROLE">Role</option>
              <option value="TERRITORY">Territory</option>
              <option value="USER">User</option>
            </Select>
          </div>
          <Button type="submit" variant="outline">
            Choose
          </Button>
        </form>
        <ActionForm action={saveSharingRuleAction} className="space-y-3">
          <input type="hidden" name="targetType" value={targetType} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Rule name</Label>
              <Input id="name" name="name" required maxLength={80} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="module">Records of</Label>
              <Select id="module" name="module" className="w-full">
                {modules.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sourceTerritoryId">In territory</Label>
              <Select id="sourceTerritoryId" name="sourceTerritoryId" required className="w-full">
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="targetId">Shared with ({targetType.toLowerCase()})</Label>
              {targetType === "USER" ? (
                <Input id="targetId" name="targetId" type="email" required placeholder="user@example.com" />
              ) : (
                <Select id="targetId" name="targetId" required className="w-full">
                  {(targetType === "ROLE" ? roles : territories).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="access">Access</Label>
              <Select id="access" name="access" className="w-full">
                <option value="READ">Read-only</option>
                <option value="READ_WRITE">Read and write</option>
              </Select>
            </div>
          </div>
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
