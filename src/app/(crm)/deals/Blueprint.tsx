"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { CurrencyInput } from "@/components/crm/fields";
import { Required } from "@/components/crm/record";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { moveDealStageAction } from "@/server/modules/deals/actions";
import { isRequirementField, REQUIREMENT_FIELDS, type RequirementField } from "@/server/modules/deals/blueprint";
import type { DealRow, PipelineInfo } from "@/server/modules/deals/queries";

type Stage = PipelineInfo["stages"][number];
type Product = { id: string; name: string; brandId: string };

interface Pending {
  deal: DealRow;
  stage: Stage;
  fields: RequirementField[];
  resolve: (ok: boolean) => void;
}

const PAYMENT = [
  ["CASH", "Cash"],
  ["BANK_FINANCE", "Bank finance"],
  ["LEASE", "Lease"],
  ["FLEET", "Fleet"],
] as const;

/**
 * Blueprint stage move. `move(deal, stage)` saves directly when the deal already satisfies the target stage's
 * required fields; otherwise it opens a dialog asking for exactly those fields. The server re-validates the
 * transition and the requirements (and rejects with a toast).
 */
export function useBlueprint(products: Product[]) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = useCallback(
    async (deal: DealRow, stage: Stage, values: Record<string, string>) => {
      const res = await moveDealStageAction(deal.id, stage.id, values);
      if (!res.ok) {
        toast(res.error.message, "error");
        return false;
      }
      toast(`Deal moved to ${stage.name}`, "success");
      router.refresh();
      return true;
    },
    [router],
  );

  const move = useCallback(
    (deal: DealRow, stage: Stage): Promise<boolean> => {
      const filled = (k: string) => {
        const v = (deal as unknown as Record<string, unknown>)[k];
        return v !== null && v !== undefined && v !== "";
      };
      const fields = stage.requiredFields.filter((k): k is RequirementField => isRequirementField(k) && !filled(k));
      // A LOST stage always asks (reason may already be there, but confirm the loss).
      if (fields.length === 0 && stage.type !== "LOST") return submit(deal, stage, {});
      const ask = stage.type === "LOST" ? ([...new Set([...fields, "lossReason", "lossCompetitorBrand"])] as RequirementField[]) : fields;
      return new Promise((resolve) => setPending({ deal, stage, fields: ask, resolve }));
    },
    [submit],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = pending ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Move to ${pending.stage.name}`} data-testid="blueprint-dialog">
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/30" onClick={() => close(false)} />
      <form
        ref={formRef}
        className="relative w-full max-w-md space-y-3 rounded-lg bg-surface p-5 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const values = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, v.toString()]));
          const ok = await submit(pending.deal, pending.stage, values);
          setBusy(false);
          if (ok) close(true);
        }}
      >
        <div>
          <h2 className="font-semibold">Move to {pending.stage.name}</h2>
          <p className="text-[13px] text-text-muted">{pending.deal.name}</p>
        </div>
        {pending.fields.map((k) => {
          const meta = REQUIREMENT_FIELDS[k];
          const required = pending.stage.requiredFields.includes(k);
          const current = (pending.deal as unknown as Record<string, unknown>)[k];
          const dv = current === null || current === undefined ? "" : String(current);
          return (
            <div key={k} className="space-y-1">
              <Label htmlFor={`bp-${k}`}>
                {meta.label}
                {required ? <Required /> : null}
              </Label>
              {meta.input === "date" ? (
                <Input id={`bp-${k}`} name={k} type="date" required={required} defaultValue={dv.slice(0, 10)} />
              ) : meta.input === "money" ? (
                <CurrencyInput id={`bp-${k}`} name={k} required={required} defaultValue={current === null || current === undefined ? null : Number(current)} />
              ) : meta.input === "model" ? (
                <Select id={`bp-${k}`} name={k} required={required} defaultValue={dv} className="w-full">
                  <option value="">Choose model…</option>
                  {products
                    .filter((p) => p.brandId === pending.deal.brandId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              ) : meta.input === "payment" ? (
                <Select id={`bp-${k}`} name={k} required={required} defaultValue={dv} className="w-full">
                  <option value="">Choose…</option>
                  {PAYMENT.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={`bp-${k}`} name={k} required={required} defaultValue={dv} />
              )}
            </div>
          );
        })}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : `Move to ${pending.stage.name}`}
          </Button>
        </div>
      </form>
    </div>
  ) : null;

  return { move, dialog };
}

/** "Next step" buttons above the stage bar on the record page. */
export function BlueprintButtons({ deal, pipeline, targets, products }: { deal: DealRow; pipeline: PipelineInfo; targets: string[]; products: Product[] }) {
  const { move, dialog } = useBlueprint(products);
  const stages = pipeline.stages.filter((s) => targets.includes(s.key));
  if (stages.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="blueprint-buttons">
      <span className="text-[13px] text-text-muted">Next step:</span>
      {stages.map((s) => (
        <Button key={s.id} size="sm" variant={s.type === "LOST" ? "outline" : s.order > (pipeline.stages.find((x) => x.id === deal.stageId)?.order ?? 0) ? "default" : "outline"} onClick={() => void move(deal, s)}>
          {s.name}
        </Button>
      ))}
      {dialog}
    </div>
  );
}
