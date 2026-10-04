import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { stageTone } from "@/components/crm/tones";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { scopedDb } from "@/server/db";
import { addStageAction, deleteStageAction, updateStageAction } from "@/server/modules/deals/actions";
import { ALL_REQUIREMENT_KEYS, requirementLabel } from "@/server/modules/deals/blueprint";
import { toPipelineInfo } from "@/server/modules/deals/queries";
import { assertAdmin } from "@/server/modules/admin/guard";
import { requireContext } from "@/server/request";

export const metadata = { title: "Pipelines & Blueprint" };

export default async function PipelinesPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandParam } = await searchParams;
  const ctx = await requireContext();
  assertAdmin(ctx);
  const rows = await scopedDb(ctx).pipeline.findMany({ include: { stages: true, brand: { select: { id: true, code: true, name: true, color: true } } }, orderBy: [{ brand: { code: "asc" } }, { name: "asc" }] });
  const current = rows.find((p) => p.brand.code === brandParam) ?? rows[0];
  if (!current) return <p className="text-sm text-text-muted">No pipelines yet – create a brand first.</p>;
  const pipeline = toPipelineInfo(current);

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1" aria-label="Brand pipelines">
        {rows.map((p) => (
          <a key={p.id} href={`/admin/pipelines?brand=${p.brand.code}`} className={p.id === current.id ? "rounded-md ring-2 ring-primary" : "rounded-md opacity-80 hover:opacity-100"}>
            <BrandBadge brand={p.brand} size="lg" />
          </a>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>
            {current.brand.code} – {pipeline.name}
          </CardTitle>
          <CardDescription>
            Blueprint: a deal moves to the previous or next stage, or to a lost stage – unless a stage lists its own allowed
            transitions. Managers of the brand may jump to any stage. “Required to enter” fields are requested in a dialog when
            a deal is moved into the stage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pipeline.stages.map((s) => (
            <ActionForm key={s.id} action={updateStageAction} className="rounded-md border border-border p-3 text-[13px]">
              <input type="hidden" name="stageId" value={s.id} />
              <div className="flex flex-wrap items-center gap-2" data-testid="pipeline-stage">
                <span className="w-6 text-text-muted">{s.order}</span>
                <Input name="name" defaultValue={s.name} className="h-8 w-48" aria-label="Stage name" required />
                <StatusPill tone={stageTone(s.type)}>{s.type}</StatusPill>
                <label className="flex items-center gap-1">
                  Probability
                  <Input name="probability" type="number" min={0} max={100} defaultValue={s.probability} className="h-8 w-20" />%
                </label>
                <label className="flex items-center gap-1">
                  Stale after
                  <Input name="maxDaysInStage" type="number" min={1} defaultValue={s.maxDaysInStage ?? ""} className="h-8 w-20" />
                  days
                </label>
                <SubmitButton size="sm" variant="outline" className="ml-auto">
                  Save
                </SubmitButton>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-text-muted">
                  Required to enter: {s.requiredFields.length ? s.requiredFields.map(requirementLabel).join(", ") : "nothing"} · Transitions:{" "}
                  {s.allowedTransitions ? s.allowedTransitions.join(", ") || "none" : "default"}
                </summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <fieldset>
                    <legend className="mb-1 font-semibold">Required to enter this stage</legend>
                    <div className="grid grid-cols-2 gap-x-3">
                      {ALL_REQUIREMENT_KEYS.map((k) => (
                        <label key={k} className="flex items-center gap-1.5">
                          <input type="checkbox" name="requiredFields" value={k} defaultChecked={s.requiredFields.includes(k)} />
                          {requirementLabel(k)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-1 font-semibold">Allowed next stages</legend>
                    <label className="mb-1 flex items-center gap-1.5">
                      <input type="checkbox" name="customTransitions" defaultChecked={s.allowedTransitions !== null} />
                      Use a custom list (otherwise: previous, next, lost)
                    </label>
                    <div className="grid grid-cols-2 gap-x-3">
                      {pipeline.stages
                        .filter((x) => x.id !== s.id)
                        .map((x) => (
                          <label key={x.id} className="flex items-center gap-1.5">
                            <input type="checkbox" name="allowedTransitions" value={x.key} defaultChecked={s.allowedTransitions?.includes(x.key) ?? false} />
                            {x.name}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                </div>
              </details>
            </ActionForm>
          ))}
          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <ActionForm action={addStageAction} className="flex items-center gap-2">
              <input type="hidden" name="pipelineId" value={pipeline.id} />
              <Input name="name" placeholder="New stage name" className="h-8 w-56" required aria-label="New stage name" />
              <SubmitButton size="sm">Add stage</SubmitButton>
            </ActionForm>
            {pipeline.stages
              .filter((s) => s.type === "OPEN" && !["ENQUIRY", "TEST_DRIVE", "QUOTATION", "BOOKING", "FINANCE_PAYMENT", "DELIVERY"].includes(s.key))
              .map((s) => (
                <ActionForm key={s.id} action={deleteStageAction} confirm={`Remove stage ${s.name}?`}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <Button size="sm" variant="ghost" type="submit">
                    Remove “{s.name}”
                  </Button>
                </ActionForm>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
