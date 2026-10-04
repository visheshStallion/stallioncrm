import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { PageTitleRow } from "@/components/crm/primitives";
import { FormSection, StickyFormFooter } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { can } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { sendMessageAction } from "@/server/modules/messaging/actions";
import { templatesFor } from "@/server/modules/messaging/campaigns";
import { MERGE_FIELDS, renderMerge } from "@/server/modules/messaging/merge";
import { CHANNEL_LABELS, loadMessageRecord } from "@/server/modules/messaging/service";
import { requireContext } from "@/server/request";

export const metadata = { title: "New message" };
const CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
type SP = { channel?: string; parentType?: string; parentId?: string; templateId?: string };

/** Write an email / SMS / WhatsApp message to the customer of a lead or deal – always sent as the record's brand. */
export default async function NewMessagePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const channel = CHANNELS.find((c) => c === sp.channel?.toUpperCase()) ?? "EMAIL";
  const record = await loadMessageRecord(ctx, sp.parentType ?? "", sp.parentId ?? "").catch((e) => {
    if (isAccessError(e) || e?.code === "BAD_REQUEST") notFound(); // missing, hidden or unsupported record
    throw e;
  });
  if (!can(ctx, "activities", "create", record)) forbidden();
  const [brand, templates] = await Promise.all([
    scopedDb(ctx).brand.findUniqueOrThrow({ where: { id: record.brandId }, select: { id: true, code: true, name: true, color: true, fromName: true, fromEmail: true, smsSenderId: true, whatsappNumber: true } }),
    templatesFor(ctx, record.brandId, channel),
  ]);
  const template = templates.find((t) => t.id === sp.templateId);
  const sender = channel === "EMAIL" ? (brand.fromEmail ? `${brand.fromName || brand.name} <${brand.fromEmail}>` : null) : channel === "SMS" ? brand.smsSenderId : brand.whatsappNumber;
  const to = channel === "EMAIL" ? record.recipient.email : record.recipient.mobile;
  const back = `${record.parentType === "Lead" ? "/leads" : "/deals"}/${record.parentId}`;
  const href = (p: Partial<SP>) => `/messages/new?${new URLSearchParams({ channel, parentType: record.parentType, parentId: record.parentId, ...p } as Record<string, string>)}`;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitleRow title={`New ${CHANNEL_LABELS[channel]}`} left={<BrandBadge brand={brand} />} />
      <nav className="mb-3 flex gap-1" aria-label="Channel">
        {CHANNELS.map((c) => (
          <Link key={c} href={href({ channel: c })} aria-current={c === channel ? "page" : undefined} className={cn("rounded-md border px-3 py-1 text-xs font-semibold", c === channel ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
            {CHANNEL_LABELS[c]}
          </Link>
        ))}
      </nav>
      <ActionForm action={sendMessageAction} className="space-y-4">
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="parentType" value={record.parentType} />
        <input type="hidden" name="parentId" value={record.parentId} />
        {template ? <input type="hidden" name="templateId" value={template.id} /> : null}
        <FormSection title="Message">
          <div className="space-y-1">
            <Label htmlFor="from">From (the record&apos;s brand)</Label>
            <Input id="from" value={sender ?? `${brand.code} has no ${CHANNEL_LABELS[channel]} sender configured`} readOnly disabled data-testid="message-from" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input id="to" value={to ? `${record.recipient.name} – ${to}` : "The customer has no address for this channel"} readOnly disabled />
          </div>
          {templates.length ? (
            <div className="space-y-1 sm:col-span-2">
              <span className="text-[13px] font-medium">Template</span>
              <div className="flex flex-wrap gap-1" data-testid="template-picker">
                <Link href={href({})} className={cn("rounded-full border px-2.5 py-0.5 text-xs", !template ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
                  None
                </Link>
                {templates.map((t) => (
                  <Link key={t.id} href={href({ templateId: t.id })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", t.id === template?.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
                    {t.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          {channel === "EMAIL" ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" maxLength={200} required key={template?.id ?? "none"} defaultValue={template ? renderMerge(template.subject ?? "", record.merge) : ""} />
            </div>
          ) : null}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="body">Text</Label>
            {channel === "WHATSAPP" && template?.whatsappStatus === "APPROVED" ? (
              <p className="rounded-md border border-border bg-muted p-2 text-[13px]" data-testid="whatsapp-template">
                {renderMerge(template.body, record.merge)}
                <span className="mt-1 block text-xs text-text-muted">Approved WhatsApp template – sent as registered.</span>
              </p>
            ) : (
              <textarea id="body" name="body" rows={channel === "EMAIL" ? 9 : 4} maxLength={4000} required key={template?.id ?? "none"} defaultValue={template ? renderMerge(template.body, record.merge) : ""} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            )}
            <p className="text-xs text-text-muted">
              Merge fields: {MERGE_FIELDS.filter((m) => m.field !== "unsubscribeUrl").map((m) => `{{${m.field}}}`).join("  ")}
              {channel === "WHATSAPP" ? " · Free text only within 24 hours of the customer's last WhatsApp message." : ""}
            </p>
          </div>
        </FormSection>
        <StickyFormFooter cancelHref={back}>
          <SubmitButton disabled={!sender || !to}>Send</SubmitButton>
        </StickyFormFooter>
      </ActionForm>
    </div>
  );
}
