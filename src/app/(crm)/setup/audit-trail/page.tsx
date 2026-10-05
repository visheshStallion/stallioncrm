import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { revertSettingAction } from "@/server/modules/setup/actions";
import { diffSnapshots, setupAuditTrail } from "@/server/modules/setup/service";
import { SETTINGS, isSettingKey } from "@/server/modules/setup/settings";
import { requireSetup } from "../guard";
import { Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "Setup Audit Trail" };

export default async function SetupAuditTrailPage({ searchParams }: { searchParams: Promise<{ page?: string; entity?: string }> }) {
  const { ctx, entry } = await requireSetup("setup-audit-trail"); // setupPermission: ADMIN
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, more, entities } = await setupAuditTrail(ctx, { page, entity: sp.entity });
  const link = (p: number) => `/setup/audit-trail?page=${p}${sp.entity ? `&entity=${sp.entity}` : ""}`;
  return (
    <div>
      <SetupHeader
        entry={entry}
        actions={
          <Link href="/admin/audit" className="crm-btn crm-btn-secondary">
            Full audit log (data changes, export)
          </Link>
        }
      />
      <form method="get" className="mb-4 flex items-end gap-2">
        <Select name="entity" defaultValue={sp.entity ?? ""} aria-label="What was changed" className="w-64">
          <option value="">Every kind of setting</option>
          {entities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Section title="Setting changes, newest first" testId="setup-audit">
        {rows.length === 0 ? <p className="text-text-muted">No setting changes recorded.</p> : null}
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const diff = diffSnapshots(r.before, r.after);
            const revertable = r.entity === "OrgSetting" && r.action === "UPDATE" && !!r.entityId && isSettingKey(r.entityId) && !SETTINGS[r.entityId].fourEyes && r.before !== null;
            return (
              <li key={r.id} className="py-2" data-testid="setup-audit-row">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={r.action === "DELETE" ? "danger" : r.action === "CREATE" ? "success" : "primary"}>{r.action.charAt(0) + r.action.slice(1).toLowerCase()}</StatusPill>
                  <span className="font-bold">{r.entity}</span>
                  {r.entityId ? <span className="text-text-muted">{r.entityId.length > 40 ? `${r.entityId.slice(0, 40)}…` : r.entityId}</span> : null}
                  <span className="ml-auto text-xs text-text-muted">
                    {r.user?.name ?? "system"} · {fmtDateTime(r.at)} · {r.ip ?? "no address"}
                  </span>
                </div>
                {diff.length ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-primary">{diff.length} field(s) changed</summary>
                    <table className="mt-1 w-full text-xs" data-testid="setup-audit-diff">
                      <thead>
                        <tr className="text-left text-text-muted">
                          <th className="pr-3 font-normal">Field</th>
                          <th className="pr-3 font-normal">Before</th>
                          <th className="font-normal">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.slice(0, 40).map((d) => (
                          <tr key={d.field} className="align-top">
                            <td className="pr-3 font-bold">{d.field}</td>
                            <td className="max-w-80 break-words pr-3 text-text-muted">{d.before.slice(0, 300)}</td>
                            <td className="max-w-80 break-words">{d.after.slice(0, 300)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
                {revertable ? (
                  <ActionForm action={revertSettingAction} className="mt-1" confirm="Put the earlier values of this setting back?">
                    <input type="hidden" name="auditId" value={r.id} />
                    <Button size="sm" variant="outline" type="submit">
                      Revert to the values before this change
                    </Button>
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          {page > 1 ? (
            <Link href={link(page - 1)} className="crm-btn crm-btn-secondary crm-btn-sm">
              Newer
            </Link>
          ) : null}
          {more ? (
            <Link href={link(page + 1)} className="crm-btn crm-btn-secondary crm-btn-sm">
              Older
            </Link>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
