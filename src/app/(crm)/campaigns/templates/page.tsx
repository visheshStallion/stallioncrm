import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { managedBrands } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { deleteTemplateAction, saveTemplateAction } from "@/server/modules/messaging/actions";
import { canManageTemplate, listTemplates } from "@/server/modules/messaging/campaigns";
import { MERGE_FIELDS } from "@/server/modules/messaging/merge";
import { CHANNEL_LABELS } from "@/server/modules/messaging/service";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Message templates" };

/** Templates: group templates (management) and brand templates (the brand's manager). `?edit=<id>` edits one. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "campaigns", "read")) forbidden();
  const [templates, dir] = await Promise.all([listTemplates(ctx), getDirectory(ctx)]);
  const editing = templates.find((t) => t.id === edit && canManageTemplate(ctx, t.brandId));
  const ownBrands = (ctx.isAdmin ? dir.brands : dir.brands.filter((b) => managedBrands(ctx).includes(b.id))).filter((b) => b.status !== "INACTIVE");
  const canGroup = canManageTemplate(ctx, null);
  const canCreate = ownBrands.length > 0 || canGroup;

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="Message templates"
        left={
          <Link href="/campaigns" className="text-sm text-primary hover:underline">
            ← Campaigns
          </Link>
        }
        actions={
          canCreate ? (
            <Link href="/campaigns/templates/email/new" className="crm-btn crm-btn-primary" data-testid="new-email-template">
              New e-mail template
            </Link>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" data-testid="templates-table">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] uppercase text-text-muted">
                <th className="px-3 py-2">Template</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border align-top last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.name}</div>
                    <div className="line-clamp-2 max-w-md whitespace-pre-wrap text-xs text-text-muted">{t.subject ? `${t.subject} — ` : ""}{t.body}</div>
                  </td>
                  <td className="px-3 py-2">{CHANNEL_LABELS[t.channel]}</td>
                  <td className="px-3 py-2">{t.brand?.code ?? "Group"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={t.active ? "success" : "neutral"}>{t.active ? "Active" : "Inactive"}</StatusPill>
                    {t.channel === "WHATSAPP" ? <div className="mt-1 text-xs text-text-muted">WhatsApp: {t.whatsappStatus.toLowerCase().replace("_", " ")}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.channel === "EMAIL" ? (
                      <Link href={`/campaigns/templates/email/${t.id}`} className="mr-3 text-xs font-semibold text-primary hover:underline">
                        Design
                      </Link>
                    ) : null}
                    {canManageTemplate(ctx, t.brandId) ? (
                      <Link href={`/campaigns/templates?edit=${t.id}`} className="text-xs font-semibold text-primary hover:underline">
                        Edit
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                    No templates yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
        {canCreate ? (
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="template-form">
            <h2 className="mb-2 text-[13px] font-semibold">{editing ? `Edit: ${editing.name}` : "New template"}</h2>
            <ActionForm key={editing?.id ?? "new"} action={saveTemplateAction} className="space-y-3">
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <input type="hidden" name="_edit" value="1" />
              <div className="space-y-1">
                <Label htmlFor="t-brand">Owner</Label>
                {editing ? (
                  <Input id="t-brand" value={editing.brand?.code ?? "Group"} readOnly disabled />
                ) : (
                  <Select id="t-brand" name="brandId" className="w-full" defaultValue={ownBrands[0]?.id ?? ""} required={!canGroup}>
                    {canGroup ? <option value="">Group (all brands)</option> : null}
                    {ownBrands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} – {b.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-channel">Channel</Label>
                <Select id="t-channel" name="channel" className="w-full" defaultValue={editing?.channel ?? "EMAIL"}>
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-name">Name</Label>
                <Input id="t-name" name="name" required maxLength={120} defaultValue={editing?.name ?? ""} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-subject">Subject (email)</Label>
                <Input id="t-subject" name="subject" maxLength={200} defaultValue={editing?.subject ?? ""} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-body">Text</Label>
                <textarea id="t-body" name="body" rows={7} required maxLength={4000} defaultValue={editing?.body ?? ""} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
                <p className="text-xs text-text-muted">{MERGE_FIELDS.map((m) => `{{${m.field}}}`).join("  ")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="t-wa-status">WhatsApp registration</Label>
                  <Select id="t-wa-status" name="whatsappStatus" className="w-full" defaultValue={editing?.whatsappStatus ?? "NOT_SUBMITTED"}>
                    <option value="NOT_SUBMITTED">Not submitted</option>
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="t-wa-name">WhatsApp template name</Label>
                  <Input id="t-wa-name" name="whatsappName" maxLength={120} defaultValue={editing?.whatsappName ?? ""} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active
              </label>
              <div className="flex items-center gap-2">
                <SubmitButton size="sm">Save template</SubmitButton>
                {editing ? (
                  <Link href="/campaigns/templates" className="text-xs text-primary hover:underline">
                    Cancel
                  </Link>
                ) : null}
              </div>
            </ActionForm>
            {editing ? (
              <ActionForm action={deleteTemplateAction} confirm="Remove this template?" className="mt-3">
                <input type="hidden" name="id" value={editing.id} />
                <SubmitButton size="sm" variant="ghost">
                  Delete template
                </SubmitButton>
              </ActionForm>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
