import { z } from "zod";

/** Per-user UI preferences. Every key has a schema; unknown keys are rejected. */
export const PREFERENCE_SCHEMAS = {
  theme: z.enum(["light", "dark", "system"]),
  density: z.enum(["comfortable", "compact"]),
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
  }),
} as const;

export type Preferences = {
  theme: z.infer<(typeof PREFERENCE_SCHEMAS)["theme"]>;
  density: z.infer<(typeof PREFERENCE_SCHEMAS)["density"]>;
  dateFormat: z.infer<(typeof PREFERENCE_SCHEMAS)["dateFormat"]>;
  rail: z.infer<(typeof PREFERENCE_SCHEMAS)["rail"]> | null;
};
export type ColumnLayout = z.infer<(typeof PREFERENCE_SCHEMAS)["columns"]>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  density: "comfortable",
  dateFormat: "DD/MM/YYYY",
  rail: null,
};

/** "columns:leads" → schema for columns; plain keys map 1:1. */
export function schemaForKey(key: string) {
  if (/^columns:[a-zA-Z]+$/.test(key)) return PREFERENCE_SCHEMAS.columns;
  return (PREFERENCE_SCHEMAS as Record<string, z.ZodTypeAny>)[key === "columns" ? "_" : key];
}
