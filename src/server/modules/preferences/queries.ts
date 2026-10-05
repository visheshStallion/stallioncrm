import "server-only";
import type { Prisma } from "@prisma/client";
import { cache } from "react";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { DEFAULT_PREFERENCES, PREFERENCE_SCHEMAS, schemaForKey, type ColumnLayout, type Preferences } from "./schema";

/** The user's preferences with defaults (request-cached). Invalid stored values fall back to defaults. */
export const getPreferences = cache(async (ctx: AccessContext): Promise<Preferences> => {
  if (ctx.system) return DEFAULT_PREFERENCES;
  const rows = await scopedDb(ctx).userPreference.findMany({
    where: { userId: ctx.userId, key: { in: ["theme", "density", "dateFormat", "rail", "nav"] } },
  });
  const out: Preferences = { ...DEFAULT_PREFERENCES };
  for (const r of rows) {
    const parsed = (PREFERENCE_SCHEMAS as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>)[r.key]?.safeParse(r.value);
    if (parsed?.success) (out as Record<string, unknown>)[r.key] = parsed.data;
  }
  return out;
});

export async function getColumnLayout(ctx: AccessContext, module: string): Promise<ColumnLayout | null> {
  const row = await scopedDb(ctx).userPreference.findUnique({
    where: { userId_key: { userId: ctx.userId, key: `columns:${module}` } },
  });
  const parsed = PREFERENCE_SCHEMAS.columns.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

/** Validates and stores one preference for the signed-in user. */
export async function setPreference(ctx: AccessContext, key: string, value: unknown): Promise<void> {
  const schema = schemaForKey(key);
  if (!schema) throw new BadRequestError("Unknown preference");
  const data = schema.parse(value) as Prisma.InputJsonValue;
  await scopedDb(ctx).userPreference.upsert({
    where: { userId_key: { userId: ctx.userId, key } },
    update: { value: data },
    create: { userId: ctx.userId, key, value: data },
  });
}
