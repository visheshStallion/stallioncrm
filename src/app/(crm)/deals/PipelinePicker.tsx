"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

/** Pipeline picker – lists only pipelines of the user's brands. "All my brands" shows one board per brand. */
export function PipelinePicker({ pipelines, current }: { pipelines: Array<{ id: string; label: string }>; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  if (pipelines.length <= 1) {
    return pipelines[0] ? (
      <span className="text-[13px] text-text-muted" data-testid="pipeline-picker">
        {pipelines[0].label}
      </span>
    ) : null;
  }
  return (
    <Select
      aria-label="Pipeline"
      data-testid="pipeline-picker"
      value={current}
      className="h-8 text-[13px]"
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set("pipeline", e.target.value);
        else p.delete("pipeline");
        p.delete("page");
        router.push(`${pathname}?${p.toString()}`);
      }}
    >
      <option value="">All my brands</option>
      {pipelines.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}
