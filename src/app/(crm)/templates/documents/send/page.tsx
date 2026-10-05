import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { bulkSendAction } from "@/server/modules/doctpl/actions";
import { MAX_BULK_SEND, SENDABLE } from "@/server/modules/doctpl/bulk";
import { listTemplates } from "@/server/modules/doctpl/service";
import { printModule } from "@/server/modules/print/modules";
import { loadPrintRecord } from "@/server/modules/print/service";
import { requireContext } from "@/server/request";

export const metadata = { title: "Send documents" };

/**
 * Bulk send from a list view: /templates/documents/send?module=invoices&ids=a,b,c – the same document template for
 * all, one e-mail per customer. Needs the mass e-mail permission; a record the user cannot open is a 404.
 */
export default async function SendDocumentsPage({ searchParams }: { searchParams: Promise<{ module?: string; ids?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  const mod = q.module && SENDABLE[q.module] ? printModule(q.module) : undefined;
  const ids = [...new Set((q.ids ?? "").split(",").filter(Boolean))].slice(0, MAX_BULK_SEND);
  if (!mod || !ids.length) notFound();
  if (!hasPermission(ctx, "campaigns", "massEmail")) forbidden();
  const records = [];
  for (const id of ids) {
    const r = await loadPrintRecord(ctx, mod.key, id).catch((e) => {
      if (isAccessError(e)) notFound();
      throw e;
    });
    records.push({ id: r.id, title: r.number ?? r.title, brandId: r.brandId });
  }
  const brandIds = [...new Set(records.map((r) => r.brandId).filter((b): b is string => !!b))];
  const [templates, emailTemplates] = await Promise.all([
    listTemplates(ctx, { module: mod.key, status: "PUBLISHED" }),
    scopedDb(ctx).template.findMany({ where: { channel: "EMAIL", active: true, AND: [{ OR: [{ brandId: null }, { brandId: { in: brandIds } }] }, { OR: [{ module: null }, { module: mod.key }] }] }, orderBy: { name: "asc" }, select: { id: true, name: true, brand: { select: { code: true } } } }),
  ]);
  // shared and group templates only: a personal template is its author's, and one template is used for all records
  const usable = templates.filter((t) => t.visibility !== "PERSONAL" && (!t.brandId || brandIds.includes(t.brandId)));
  const back = `/${mod.key}`;

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitleRow
        title={`Send ${records.length} ${records.length === 1 ? mod.label.toLowerCase() : mod.plural.toLowerCase()}`}
        left={
          <Link href={back} className="text-sm text-primary hover:underline">
            ← Back to the list
          </Link>
        }
      />
      <ActionForm action={bulkSendAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <input type="hidden" name="module" value={mod.key} />
        <input type="hidden" name="ids" value={records.map((r) => r.id).join(",")} />
        <p className="text-sm">
          Each customer gets one e-mail with their own document as a PDF, from the sender address and on the letterhead of the document&apos;s brand. Customers without an e-mail address are listed in the report.
        </p>
        <p className="max-h-24 overflow-auto rounded border border-border bg-surface-alt p-2 text-xs text-text-muted" data-testid="bulk-send-records">
          {records.map((r) => r.title).join(" · ")}
        </p>
        <div className="space-y-1">
          <Label htmlFor="bs-doc">Document template</Label>
          <select id="bs-doc" name="documentTemplate" className="crm-select w-full" defaultValue="default">
            <option value="default">Each brand&apos;s default template</option>
            {usable.map((t) => (
              <option key={t.id} value={`doc:${t.id}`}>
                {t.name} ({t.brandCode ?? "all brands"})
              </option>
            ))}
          </select>
          {brandIds.length > 1 ? <p className="text-xs text-text-muted">The selection has documents of several brands: a template of one brand is only used for that brand&apos;s documents – the others are reported as not sent.</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="bs-mail">E-mail text</Label>
          <select id="bs-mail" name="emailTemplateId" className="crm-select w-full" defaultValue="">
            <option value="">Short standard text (“Please find your document attached”)</option>
            {emailTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.brand?.code ?? "group"})
              </option>
            ))}
          </select>
        </div>
        <SubmitButton>Send to {records.length} customer{records.length === 1 ? "" : "s"}</SubmitButton>
      </ActionForm>
    </div>
  );
}
