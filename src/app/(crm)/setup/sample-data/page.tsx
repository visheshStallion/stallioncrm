import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestRemoveSampleDataAction } from "@/server/modules/setup/actions";
import { sampleDataCounts } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { ReauthFields, Section, SetupHeader } from "../_components";

export const metadata = { title: "Remove sample data" };

export default async function SampleDataPage() {
  const { ctx, entry } = await requireSetup("remove-sample-data"); // setupPermission: SA (+ four eyes)
  const counts = await sampleDataCounts(ctx);
  const total = counts.reduce((s, c) => s + c.count, 0);
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title={`Business data in this installation: ${total} rows`} hint="Before go-live the demo records are removed in one step. This empties ALL business tables – it cannot tell demo records from real ones, so use it only before real work has started." testId="sample-counts">
        {total === 0 ? (
          <p className="text-text-muted">There is no business data.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-3">
            {counts.map((c) => (
              <li key={c.table} className="flex justify-between border-b border-border py-0.5">
                <span>{c.table}</span>
                <span className="text-text-muted">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <strong>Kept:</strong> brands, regions, territories, users, roles, profiles, pipelines, products, price books, warehouses, templates, rules, settings and the audit log. <strong>Not removed either:</strong> the demo users – deactivate them under
          Users – and uploaded files in the file store.
        </p>
      </Section>
      {total > 0 ? (
        <Section title="Remove all business data" testId="sample-remove">
          <ActionForm action={requestRemoveSampleDataAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="confirm">Type REMOVE to confirm</Label>
              <Input id="confirm" name="confirm" required className="w-40" autoComplete="off" />
            </div>
            <ReauthFields id="sample" />
            <div className="flex justify-end">
              <SubmitButton variant="destructive">Request removal</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : null}
    </div>
  );
}
