import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { isAccessError } from "@/server/access/errors";
import { discardDraftAction } from "@/server/modules/email/actions";
import { EMAIL_PARENTS, PARENT_INFO, composerData, type EmailParent } from "@/server/modules/email/service";
import { requireContext } from "@/server/request";
import { Composer, type ComposerDraft } from "./Composer";

export const metadata = { title: "Send e-mail" };

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(d) : "");

/**
 * E-mail composer for a record: /email/compose?type=Deal&id=…  (shared customers: &brand=… picks the sending brand).
 * A record the user cannot see – or of a brand they are not in – does not exist here (404).
 */
export default async function ComposePage({ searchParams }: { searchParams: Promise<{ type?: string; id?: string; brand?: string; draft?: string; attach?: string }> }) {
  const { type, id, brand, draft, attach } = await searchParams;
  const ctx = await requireContext();
  if (!type || !id || !(EMAIL_PARENTS as readonly string[]).includes(type)) notFound();
  const data = await composerData(ctx, type, id, brand).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const open = data.drafts.find((d) => d.id === draft && d.status !== "SCHEDULED");
  const initial: ComposerDraft | null = open ? { id: open.id, payload: open.payload } : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title={`E-mail to ${data.record.name}`}
        left={
          <Link href={data.record.path} className="text-sm text-primary hover:underline">
            ← Back to the {data.record.label.toLowerCase()}
          </Link>
        }
      />
      {data.from ? null : (
        <p className="mb-3 rounded-md border border-border bg-surface p-3 text-sm" role="alert" data-testid="no-sender">
          {data.brandLabel} has no e-mail sender yet. An administrator sets it under Setup → Brands; until then e-mails cannot be sent for this brand.
        </p>
      )}
      {data.drafts.length ? (
        <section className="mb-3 rounded-md border border-border bg-surface p-3 text-sm" data-testid="email-drafts">
          <h2 className="mb-1 text-[13px] font-semibold">Your drafts and scheduled e-mails for this record</h2>
          <ul className="space-y-1">
            {data.drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <StatusPill tone={d.status === "SCHEDULED" ? "primary" : d.status === "FAILED" ? "danger" : "neutral"}>{d.status === "SCHEDULED" ? `Scheduled · ${fmt(d.sendAt)}` : d.status === "FAILED" ? "Not sent" : "Draft"}</StatusPill>
                <span className="truncate">{String(d.payload.subject ?? "(no subject)")}</span>
                {d.error ? <span className="text-xs text-text-muted">{d.error}</span> : null}
                {d.status !== "SCHEDULED" ? (
                  <Link className="text-xs font-semibold text-primary hover:underline" href={`/email/compose?type=${data.record.parentType}&id=${data.record.parentId}${brand ? `&brand=${brand}` : ""}&draft=${d.id}`}>
                    Open
                  </Link>
                ) : null}
                <ActionForm action={discardDraftAction} confirm={d.status === "SCHEDULED" ? "Cancel this scheduled e-mail?" : "Remove this draft?"}>
                  <input type="hidden" name="draftId" value={d.id} />
                  <SubmitButton size="sm" variant="ghost">
                    {d.status === "SCHEDULED" ? "Cancel" : "Remove"}
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Composer
        key={`${data.record.brandId}:${initial?.id ?? "new"}`}
        record={data.record}
        from={data.from}
        brandLabel={data.brandLabel}
        brands={data.brands}
        suggestions={data.suggestions}
        templates={data.templates}
        hasSignature={data.hasSignature}
        attachments={data.attachments}
        printTemplates={data.printTemplates}
        docTemplates={data.docTemplates}
        generated={data.generated}
        attachDocument={attach === "1"}
        printPath={`/print/${PARENT_INFO[data.record.parentType as EmailParent].module}/${data.record.parentId}`}
        mergeFields={data.mergeFields}
        allowHtml={ctx.isAdmin}
        draft={initial}
      />
    </div>
  );
}
