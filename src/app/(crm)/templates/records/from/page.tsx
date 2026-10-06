import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/server/access/can";
import { rtModule } from "@/server/modules/rectpl/modules";
import { saveRecordAsTemplateAction } from "@/server/modules/templates/actions";
import { requireContext } from "@/server/request";

export const metadata = { title: "Save as template" };

/** "Save as template" of a record: /templates/records/from?module=leads&id=… → a personal draft, opened in the editor. */
export default async function SaveAsTemplatePage({ searchParams }: { searchParams: Promise<{ module?: string; id?: string }> }) {
  const q = await searchParams;
  const ctx = await requireContext();
  const mod = rtModule(q.module ?? "");
  if (!mod || mod.document || !q.id) notFound();
  if (!hasPermission(ctx, mod.permission, "create")) forbidden();
  return (
    <div className="mx-auto max-w-xl">
      <PageTitleRow
        title={`Save this ${mod.label.toLowerCase()} as a template`}
        left={
          <Link href={mod.recordHref(q.id)} className="text-sm text-primary hover:underline">
            ← Back to the {mod.label.toLowerCase()}
          </Link>
        }
      />
      <ActionForm action={saveRecordAsTemplateAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <input type="hidden" name="module" value={mod.key} />
        <input type="hidden" name="recordId" value={q.id} />
        <p className="text-sm">
          The reusable values of the record (source, type, payment, model, …) become a personal template. What identifies this customer or record is left out: names, phone numbers, e-mail addresses, VIN, numbers, links to other records, the owner and dates.
        </p>
        <div className="space-y-1">
          <Label htmlFor="sat-name">Template name</Label>
          <Input id="sat-name" name="name" required minLength={2} maxLength={100} />
        </div>
        <SubmitButton>Create the template</SubmitButton>
      </ActionForm>
    </div>
  );
}
