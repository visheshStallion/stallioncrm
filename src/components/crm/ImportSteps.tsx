import { cn } from "@/lib/utils";

export const IMPORT_STEPS = ["Upload", "Actions", "Module - File Mapping", "Field Mapping", "Assign"] as const;

/** The import wizard's step bar (Upload → Actions → Module - File Mapping → Field Mapping → Assign). */
export function ImportSteps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[12px]" aria-label="Import steps" data-testid="import-steps">
      {IMPORT_STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn("flex items-center gap-1.5 rounded px-3 py-1", i === current ? "border border-warning bg-warning/10 font-semibold" : i < current ? "bg-success/10 text-text" : "bg-muted text-text-muted")}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", i === current ? "bg-warning" : i < current ? "bg-success" : "bg-text-subtle")} aria-hidden />
          {s}
        </li>
      ))}
    </ol>
  );
}
