/**
 * Account security and access review (prompt 15).
 *  - Two-step sign-in (TOTP) for the signed-in user: start → confirm with a code → on; off needs a code.
 *  - Administrators: clear a lockout, reset a user's two-step sign-in, the quarterly access review.
 */
import "server-only";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { newTotpSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from "@/server/auth/protection";
import { audit } from "@/server/db";
import { accessReviewRows, storeTotp, totpState, unlockUser } from "@/server/db/system";
import { BadRequestError } from "@/server/errors";

function assertInteractive(ctx: AccessContext) {
  if (ctx.tokenId || ctx.system) throw new BadRequestError("Sign-in security is managed in the application");
}
function assertAdmin(ctx: AccessContext) {
  if (!ctx.isAdmin || ctx.tokenId) throw new NotFoundError();
}

export async function twoStepStatus(ctx: AccessContext): Promise<{ enabled: boolean; pending: boolean }> {
  const s = await totpState(ctx.userId);
  return { enabled: !!s?.totpEnabledAt, pending: !!s?.totpSecret && !s.totpEnabledAt };
}

/** Creates a new secret (not active yet) and returns it for the authenticator app. Shown once. */
export async function startTwoStep(ctx: AccessContext): Promise<{ secret: string; uri: string }> {
  assertInteractive(ctx);
  const s = await totpState(ctx.userId);
  if (s?.totpEnabledAt) throw new BadRequestError("Two-step sign-in is already on");
  const secret = newTotpSecret();
  await storeTotp(ctx.userId, sealSecret(secret), false);
  return { secret, uri: otpauthUri(secret, ctx.user.email) };
}

/** The first valid code proves the authenticator app has the secret – only then is two-step sign-in on. */
export async function confirmTwoStep(ctx: AccessContext, code: string): Promise<void> {
  assertInteractive(ctx);
  const s = await totpState(ctx.userId);
  const secret = s?.totpSecret && !s.totpEnabledAt ? openSecret(s.totpSecret) : null;
  if (!secret) throw new BadRequestError("Start the setup first");
  if (!verifyTotp(secret, code)) throw new BadRequestError("That code is not correct – check the time on your phone and try again");
  await storeTotp(ctx.userId, s!.totpSecret, true);
  await audit({ ctx, action: "UPDATE", entity: "User", entityId: ctx.userId, after: { twoStep: "enabled" } });
}

export async function disableTwoStep(ctx: AccessContext, code: string): Promise<void> {
  assertInteractive(ctx);
  const s = await totpState(ctx.userId);
  const secret = s?.totpSecret && s.totpEnabledAt ? openSecret(s.totpSecret) : null;
  if (!secret) throw new BadRequestError("Two-step sign-in is not on");
  const { getSetting } = await import("@/server/modules/setup/service");
  if ((await getSetting("mfaPolicy")).requiredProfileIds.includes(ctx.profile.id)) throw new ForbiddenError("Two-step sign-in is required for your profile and cannot be switched off");
  if (!verifyTotp(secret, code)) throw new BadRequestError("That code is not correct");
  await storeTotp(ctx.userId, null, false);
  await audit({ ctx, action: "UPDATE", entity: "User", entityId: ctx.userId, after: { twoStep: "disabled" } });
}

/** A user lost their phone: the administrator switches two-step sign-in off and clears any lockout. */
export async function resetUserSignIn(ctx: AccessContext, userId: string): Promise<void> {
  assertAdmin(ctx);
  if (!(await totpState(userId))) throw new NotFoundError();
  await storeTotp(userId, null, false);
  await unlockUser(userId);
  await audit({ ctx, action: "UPDATE", entity: "User", entityId: userId, after: { twoStep: "reset by administrator", unlocked: true } });
}

export interface AccessReviewRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  kind: "user" | "integration";
  role: string;
  profile: string;
  scope: string;
  brands: string[];
  regions: string[];
  territories: string[];
  managerOf: string[];
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  twoStep: boolean;
  locked: boolean;
  /** what the reviewer should look at */
  flags: string[];
}

export const INACTIVE_DAYS = 90;

/** Users × brands × regions with last sign-in – run quarterly. Administrators only; the review itself is audited. */
export async function accessReview(ctx: AccessContext, now = new Date()): Promise<AccessReviewRow[]> {
  assertAdmin(ctx);
  const rows = await accessReviewRows();
  await audit({ ctx, action: "EXPORT", entity: "AccessReview", after: { users: rows.length } });
  return rows.map((u) => {
    const brands = [...new Set(u.memberships.map((m) => m.territory.brand?.code).filter((b): b is string => !!b))].sort();
    const regions = [...new Set(u.memberships.map((m) => m.territory.region?.name).filter((r): r is string => !!r))].sort();
    const days = u.lastLoginAt ? Math.floor((now.getTime() - u.lastLoginAt.getTime()) / 86_400_000) : null;
    const all = u.profile.scope === "ALL";
    const flags: string[] = [];
    if (u.active && !u.isIntegration && (days === null ? now.getTime() - u.createdAt.getTime() > INACTIVE_DAYS * 86_400_000 : days > INACTIVE_DAYS)) flags.push(days === null ? "never signed in" : `no sign-in for ${days} days`);
    if (u.active && all) flags.push("sees all brands");
    if (u.active && !all && brands.length > 1) flags.push(`${brands.length} brands`);
    if (u.active && !all && u.memberships.length === 0) flags.push("no territory – sees nothing");
    if (!u.active && u.memberships.length > 0) flags.push("inactive but still in territories");
    return { id: u.id, name: u.name, email: u.email, active: u.active, kind: u.isIntegration ? "integration" : "user", role: u.role.name, profile: u.profile.name, scope: u.profile.scope, brands: all ? ["ALL"] : brands, regions: all ? ["ALL"] : regions, territories: u.memberships.map((m) => m.territory.name).sort(), managerOf: u.memberships.filter((m) => m.isManager).map((m) => m.territory.name).sort(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null, daysSinceLogin: days, twoStep: !!u.totpEnabledAt, locked: !!u.lockedUntil && u.lockedUntil > now, flags };
  });
}
