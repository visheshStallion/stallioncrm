import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { rlsSessionQueries } from "@/server/db/rls";
import { unsafeDb } from "@/server/db/unsafe";
import { email } from "../../prisma/seed-data";

export { unsafeDb };

export async function userId(key: string): Promise<string> {
  const u = await unsafeDb.user.findUniqueOrThrow({ where: { email: email(key) }, select: { id: true } });
  return u.id;
}

export async function ctxFor(key: string): Promise<AccessContext> {
  const ctx = await loadAccessContext(await userId(key));
  if (!ctx) throw new Error(`no access context for ${key}`);
  return ctx;
}

export async function ids() {
  const brands = await unsafeDb.brand.findMany();
  const regions = await unsafeDb.region.findMany();
  return {
    brand: (code: string) => brands.find((b) => b.code === code)!.id,
    brandCode: (id: string) => brands.find((b) => b.id === id)!.code,
    region: (name: string) => regions.find((r) => r.name === name)!.id,
    regionName: (id: string) => regions.find((r) => r.id === id)!.name,
  };
}

/** Raw SQL as the user, straight through Postgres RLS – no Prisma extension involved. */
export async function rawAsUser<T = unknown>(ctx: AccessContext, sql: string): Promise<T[]> {
  const [, , rows] = await unsafeDb.$transaction([
    ...rlsSessionQueries(unsafeDb, ctx),
    unsafeDb.$queryRawUnsafe<T[]>(sql),
  ]);
  return rows as T[];
}

/** Raw SQL as the RLS role with NO session settings. */
export async function rawWithoutContext<T = unknown>(sql: string): Promise<T[]> {
  const [, rows] = await unsafeDb.$transaction([
    unsafeDb.$executeRawUnsafe("SET LOCAL ROLE stallion_rls"),
    unsafeDb.$queryRawUnsafe<T[]>(sql),
  ]);
  return rows as T[];
}
