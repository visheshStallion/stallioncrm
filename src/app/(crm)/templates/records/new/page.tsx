import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { PageTitleRow } from "@/components/crm/primitives";
import { hasPermission } from "@/server/access/can";
import { rtModule } from "@/server/modules/rectpl/modules";
import { editorLookups, templateBrandOptions } from "@/server/modules/rectpl/service";
import { recordStarter } from "@/server/modules/rectpl/starters";
import { requireContext } from "@/server/request";
import { RecordTemplateEditor } from "../Editor";

export const metadata = { title: "New record template" };

/** New record template: /templates/records/new?module=leads[&brand=…][&starter=…] (from "New Template" in the hub). */
export default async function NewRecordTemplatePage({ searchParams }: { searchParams: Promise<{ module?: string; brand?: string; starter?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  const mod = rtModule(q.module ?? "");
  if (!mod) notFound();
  if (!hasPermission(ctx, mod.permission, "create")) forbidden();
  const options = await templateBrandOptions(ctx);
  const group = q.brand === "group" && options.group;
  const brandId = options.brands.some((b) => b.id === q.brand) ? q.brand! : null;
  const starter = q.starter ? recordStarter(q.starter) : undefined;
  if (q.starter && (!starter || starter.module !== mod.key)) notFound();
  const lookups = await editorLookups(ctx, mod.key, brandId);
  const b = starter?.body;
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitleRow
        title={`New ${mod.label.toLowerCase()} template`}
        left={
          <Link href="/templates?tab=record" className="text-sm text-primary hover:underline">
            ← Templates
          </Link>
        }
      />
      <RecordTemplateEditor
        templateId={null}
        module={mod.key}
        moduleLabel={mod.label}
        brands={options.brands}
        group={options.group}
        meta={{ brandId, visibility: group ? "PUBLIC_GROUP" : "PERSONAL" }}
        fields={lookups.fields}
        hasLines={lookups.hasLines}
        hasChildren={lookups.hasChildren}
        products={lookups.products}
        emailTemplates={lookups.emailTemplates}
        documentTemplates={lookups.documentTemplates}
        initial={{ name: b?.name ?? "", description: b?.description ?? "", fieldValues: (b?.fieldValues ?? {}) as never, lockedFields: b?.lockedFields ?? [], hiddenFields: b?.hiddenFields ?? [], lineItems: [], childRecords: (b?.childRecords ?? []).map((c) => ({ subject: c.subject, type: c.type ?? "TASK", dueInHours: Number(c.dueInHours ?? 24), priority: c.priority ?? "NORMAL" })), emailTemplateId: null, documentTemplateId: null }}
        canEdit
      />
    </div>
  );
}
