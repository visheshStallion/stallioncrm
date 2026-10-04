import { beforeAll, describe, expect, it } from "vitest";
import { loadAccessContext } from "@/server/access/context";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, openSecret, totpCode } from "@/server/auth/protection";
import { findUserForLogin, pingDatabase, recordLoginFailure, recordLoginSuccess } from "@/server/db/system";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal, updateDeal } from "@/server/modules/deals/service";
import * as security from "@/server/modules/security/service";
import { email } from "../../prisma/seed-data";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let admin: AccessContext;
let exec: AccessContext;
let bm: AccessContext;

beforeAll(async () => {
  I = await ids();
  [admin, exec, bm] = (await Promise.all(["admin", "exec.hmnl.1", "bm.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext];
  process.env.AUTH_SECRET ??= "integration-test-secret";
});

describe("sign-in protection", () => {
  it("locks the account after repeated failures and unlocks on success or by an administrator", async () => {
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) expect(await recordLoginFailure(exec.userId, MAX_FAILED_LOGINS, LOCKOUT_MINUTES)).toEqual({ locked: false });
    expect((await findUserForLogin(email("exec.hmnl.1")))!.lockedUntil).toBeNull();
    expect(await recordLoginFailure(exec.userId, MAX_FAILED_LOGINS, LOCKOUT_MINUTES)).toEqual({ locked: true });
    const locked = (await findUserForLogin(email("exec.hmnl.1")))!;
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + (LOCKOUT_MINUTES - 1) * 60_000);
    expect(locked.failedLogins).toBe(0); // the counter restarts after the lock
    // an executive cannot unlock anyone; the administrator can
    await expect(security.resetUserSignIn(exec, exec.userId)).rejects.toBeInstanceOf(NotFoundError);
    await security.resetUserSignIn(admin, exec.userId);
    expect((await findUserForLogin(email("exec.hmnl.1")))!.lockedUntil).toBeNull();
    await recordLoginFailure(exec.userId, MAX_FAILED_LOGINS, LOCKOUT_MINUTES);
    await recordLoginSuccess(exec.userId);
    const ok = (await findUserForLogin(email("exec.hmnl.1")))!;
    expect([ok.failedLogins, ok.lockedUntil]).toEqual([0, null]);
    expect((await unsafeDb.user.findUniqueOrThrow({ where: { id: exec.userId } })).lastLoginAt).not.toBeNull();
  });

  it("two-step sign-in: set up, confirm with a code, switch off with a code; the secret is never readable", async () => {
    expect(await security.twoStepStatus(bm)).toEqual({ enabled: false, pending: false });
    const { secret, uri } = await security.startTwoStep(bm);
    expect(uri).toContain(secret);
    expect(await security.twoStepStatus(bm)).toEqual({ enabled: false, pending: true });
    await expect(security.confirmTwoStep(bm, "000000")).rejects.toThrow(/not correct/);
    await security.confirmTwoStep(bm, totpCode(secret));
    expect(await security.twoStepStatus(bm)).toEqual({ enabled: true, pending: false });
    await expect(security.startTwoStep(bm)).rejects.toThrow(/already on/);
    // stored encrypted; not selectable by any user session, not returned by the ORM by default
    const stored = (await findUserForLogin(email("bm.hmnl")))!;
    expect(stored.totpSecret).not.toContain(secret);
    expect(openSecret(stored.totpSecret!)).toBe(secret);
    await expect(rawAsUser(admin, `SELECT "totpSecret" FROM "User" LIMIT 1`)).rejects.toThrow(/permission denied/);
    await expect(rawAsUser(admin, `SELECT "passwordHash" FROM "User" LIMIT 1`)).rejects.toThrow(/permission denied/);
    expect(Object.keys((await unsafeDb.user.findUniqueOrThrow({ where: { id: bm.userId } })) as object)).not.toContain("totpSecret");
    await expect(security.disableTwoStep(bm, "123456")).rejects.toThrow(/not correct/);
    await security.disableTwoStep(bm, totpCode(secret));
    expect(await security.twoStepStatus(bm)).toEqual({ enabled: false, pending: false });
    // API tokens cannot change sign-in security
    await expect(security.startTwoStep({ ...bm, tokenId: "t" })).rejects.toThrow(/managed in the application/);
  });
});

describe("field-level security on writes and screens", () => {
  it("a profile with a read-only or hidden field cannot change it through an update", async () => {
    const deal = await createDeal(exec, { name: "FLS deal", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), amount: 20_000_000 } as never);
    const restricted: AccessContext = { ...exec, profile: { ...exec.profile, fieldPermissions: { deals: { amount: "hidden", colour: "read" } } } };
    await updateDeal(restricted, deal.id, { amount: 1, colour: "Pink", name: "FLS deal renamed" } as never);
    const after = await getDeal(exec, deal.id);
    expect(after).toMatchObject({ name: "FLS deal renamed", amount: 20_000_000 });
    expect(after.colour).not.toBe("Pink");
    // without the restriction the same update goes through
    await updateDeal(exec, deal.id, { amount: 21_000_000, colour: "Blue" } as never);
    expect(await getDeal(exec, deal.id)).toMatchObject({ amount: 21_000_000, colour: "Blue" });
  });
});

describe("access review and audit log", () => {
  it("lists every user with brands, regions, last sign-in and what to look at – administrators only", async () => {
    await expect(security.accessReview(exec)).rejects.toBeInstanceOf(NotFoundError);
    const stale = await unsafeDb.user.create({ data: { name: "Stale User", email: `stale.${Date.now()}@example.test`, roleId: (await unsafeDb.role.findFirstOrThrow()).id, profileId: (await unsafeDb.profile.findFirstOrThrow({ where: { name: "Sales Exec" } })).id, createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    const rows = await security.accessReview(admin);
    const row = (key: string) => rows.find((r) => r.email === email(key))!;
    expect(row("exec.hmnl.1")).toMatchObject({ brands: ["HMNL"], regions: ["Lagos"], profile: "Sales Exec", active: true });
    expect(row("exec.multi.1").brands).toEqual(["HMNL", "SNMNL"]);
    expect(row("exec.multi.1").flags).toContain("2 brands");
    expect(row("md")).toMatchObject({ brands: ["ALL"], regions: ["ALL"] });
    expect(row("md").flags).toContain("sees all brands");
    expect(row("bm.hmnl").managerOf.length).toBeGreaterThan(0);
    const s = rows.find((r) => r.id === stale.id)!;
    expect(s.flags).toEqual(expect.arrayContaining(["never signed in", "no territory – sees nothing"]));
    // the review itself is audited
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "AccessReview" }, orderBy: { at: "desc" } });
    expect(entry.userId).toBe(admin.userId);
    void loadAccessContext;
  });

  it("the audit log cannot be changed or deleted by anyone; user sessions cannot read it", async () => {
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ orderBy: { at: "desc" } });
    await expect(unsafeDb.auditLog.update({ where: { id: entry.id }, data: { action: "DELETE" } })).rejects.toThrow(/append-only/);
    await expect(unsafeDb.auditLog.updateMany({ where: { id: entry.id }, data: { ip: "1.1.1.1" } })).rejects.toThrow(/append-only/);
    await expect(unsafeDb.auditLog.deleteMany({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    for (const ctx of [exec, bm, admin]) {
      await expect(rawAsUser(ctx, `SELECT id FROM "AuditLog" LIMIT 1`)).rejects.toThrow(/permission denied/);
      await expect(rawAsUser(ctx, `DELETE FROM "AuditLog"`)).rejects.toThrow(/permission denied/);
    }
    expect(await pingDatabase()).toBe(true);
  });
});
