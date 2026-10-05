import { z } from "zod";

/** Per-user UI preferences. Every key has a schema; unknown keys are rejected. */
export const PREFERENCE_SCHEMAS = {
  theme: z.enum(["light", "dark", "system"]),
  /** standard = 13px baseline · comfortable = 14px · compact = 13px with 32px rows */
  density: z.enum(["standard", "comfortable", "compact"]),
  /** navigation mode: dark module sidebar, or classic module tabs under the header */
  nav: z.enum(["sidebar", "classic"]),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  rail: z.object({
    order: z.array(z.string()).max(50),
    pinned: z.array(z.string()).max(50),
    collapsed: z.boolean(),
  }),
  /** columns:<module> – visible order, hidden ids, frozen first column */
  columns: z.object({
    order: z.array(z.string()).max(60),
    hidden: z.array(z.string()).max(60),
    freezeFirst: z.boolean(),
    /** column id → width in px (set by dragging the edge of a header) */
    widths: z.record(z.number().int().min(60).max(800)).optional(),
  }),
} as const;

export type Preferences = {
  theme: z.infer<(typeof PREFERENCE_SCHEMAS)["theme"]>;
  density: z.infer<(typeof PREFERENCE_SCHEMAS)["density"]>;
  nav: z.infer<(typeof PREFERENCE_SCHEMAS)["nav"]>;
  dateFormat: z.infer<(typeof PREFERENCE_SCHEMAS)["dateFormat"]>;
  rail: z.infer<(typeof PREFERENCE_SCHEMAS)["rail"]> | null;
};
export type ColumnLayout = z.infer<(typeof PREFERENCE_SCHEMAS)["columns"]>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  density: "standard",
  nav: "sidebar",
  dateFormat: "DD/MM/YYYY",
  rail: null,
};

/** "columns:leads" → schema for columns; plain keys map 1:1. */
export function schemaForKey(key: string) {
  if (/^columns:[a-zA-Z]+$/.test(key)) return PREFERENCE_SCHEMAS.columns;
  return (PREFERENCE_SCHEMAS as Record<string, z.ZodTypeAny>)[key === "columns" ? "_" : key];
}
