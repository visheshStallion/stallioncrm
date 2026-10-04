/**
 * Narrow, named system queries that must run without a user context (login, building the access
 * context itself). Each one returns only what its caller needs. Do not add general-purpose helpers.
 */
import "server-only";
import { unsafeDb } from "./unsafe";

/** Login: includes the password hash – the only query that may. */
export function findUserForLogin(email: string) {
  return unsafeDb.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, active: true, passwordHash: true },
  });
}

/** SSO: match an existing active user by email (no auto-provisioning). */
export function findActiveUserIdByEmail(email: string) {
  return unsafeDb.user.findFirst({
    where: { email: email.trim().toLowerCase(), active: true },
    select: { id: true },
  });
}

/** Everything getAccessContext needs, in one round trip. */
export function loadAccessRows(userId: string) {
  return unsafeDb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      role: { select: { name: true } },
      profile: {
        select: { id: true, name: true, scope: true, permissions: true, fieldPermissions: true },
      },
      memberships: {
        select: {
          isManager: true,
          territory: { select: { id: true, brandId: true, regionId: true } },
        },
      },
    },
  });
}

export type AccessRows = NonNullable<Awaited<ReturnType<typeof loadAccessRows>>>;

/** Brand ids visible to scope-ALL users (active + future). */
export async function loadAllBrandIds(): Promise<string[]> {
  const brands = await unsafeDb.brand.findMany({
    where: { status: { not: "INACTIVE" } },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  return brands.map((b) => b.id);
}
