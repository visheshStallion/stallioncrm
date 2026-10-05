import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { getDirectory } from "@/server/modules/org/queries";
import { requestPurgeAction, restoreRecordsAction } from "@/server/modules/setup/actions";
import { readSettingFor, recycleBin } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { ReauthFields, Section, SetupHeader, SettingForm, fmtDateTime } from "../_components";

export const metadata = { title: "Recycle Bin" };

export default async function RecycleBinPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { ctx, entry } = await requireSetup("recycle-bin"); // setupPermission: ADMIN (purge: SA + four eyes)
  const sp = await searchParams;
  const [{ counts, model, rows }, dir, retention] = await Promise.all([recycleBin(ctx, sp.model), getDirectory(ctx), readSettingFor(ctx, "recycleBin")]);
  const brand = (id: string | null) => (id ? dir.brands.find((b) => b.id === id) : null);
  return (
    <div>
      <SetupHeader entry={entry} />
      <div className="mb-4 flex flex-wrap gap-2" data-testid="recycle-models">
        {counts.map((c) => (
          <Link key={c.model} href={`/setup/recycle-bin?model=${c.model}`} aria-current={c.model === model ? "page" : undefined} className={`crm-pill border-border-strong ${c.model === model ? "bg-primary-soft text-primary" : ""}`}>
            {c.model} · {c.count}
          </Link>
        ))}
      </div>

      <Section title={`Deleted ${model} records (${rows.length}${rows.length === 200 ? "+" : ""})`} hint="Restoring puts a record back exactly as it was. Records that were merged into another customer are not listed: the surviving record holds their data." testId="recycle-rows">
        {rows.length === 0 ? (
          <p className="text-text-muted">Nothing deleted in this module.</p>
        ) : (
          <ActionForm action={restoreRecordsAction} className="space-y-3">
            <input type="hidden" name="model" value={model} />
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="recycle-row">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" name="ids" value={r.id} />
                    {brand(r.brandId) ? <BrandBadge brand={brand(r.brandId)} /> : null}
                    <span className="truncate">{r.title}</span>
                  </label>
                  <span className="text-xs text-text-muted">deleted {fmtDateTime(r.deletedAt)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <SubmitButton variant="outline">Restore selected</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>

      {ctx.isSuperAdmin ? (
        <Section title="Purge for good" hint={`Deletes every ${model} record in the recycle bin permanently. A record that something else still refers to is kept.`} testId="recycle-purge">
          <ActionForm action={requestPurgeAction} className="space-y-3" confirm={`Ask for the permanent deletion of all deleted ${model} records?`}>
            <input type="hidden" name="model" value={model} />
            <ReauthFields id="purge" />
            <div className="flex justify-end">
              <SubmitButton variant="destructive">Request purge</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : null}

      <Section title="Retention" testId="recycle-retention">
        <SettingForm settingKey="recycleBin" value={retention} />
      </Section>
    </div>
  );
}
