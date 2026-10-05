"use server";

import { hash, verify } from "@node-rs/argon2";
import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { safeAction, type ActionResult } from "@/server/api";
import { audit } from "@/server/db";
import { credentialsOf, findUserByEmail, recordPasswordChange } from "@/server/db/setup-store";
import { unsafeSetOwnPassword } from "@/server/db/system";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import { assertSetup } from "./access";
import { importConfiguration, validateConfiguration } from "./config";
import { cancelDestructive, decideDestructive, requestDestructive } from "./destructive";
import * as svc from "./service";
import { SETTINGS, isSettingKey, parseSettingForm } from "./settings";

export interface FormOutcome {
  message?: string;
  redirect?: string;
}
type Result = ActionResult<FormOutcome>;

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();
const opt = (fd: FormData, key: string) => str(fd, key) || null;
const req = (fd: FormData, key: string) => {
  const v = str(fd, key);
  if (!v) throw new BadRequestError(`${key} is required`);
  return v;
};
/** Re-authentication fields of a destructive form (the password is never trimmed). */
const reauth = (fd: FormData) => ({ password: (fd.get("reauthPassword") ?? "").toString() || null, code: opt(fd, "reauthCode") });

const WAITING = "Sent for approval: a second Super Admin must approve it under Setup → Two-person approvals";

async function run(fn: (ctx: AccessContext) => Promise<FormOutcome | string | void>): Promise<Result> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const out = await fn(ctx);
    revalidatePath("/setup", "layout");
    return typeof out === "string" ? { message: out } : (out ?? { message: "Saved" });
  });
}

// ── settings ──
export async function saveSettingAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const key = req(fd, "_key");
    if (!isSettingKey(key)) throw new BadRequestError("Unknown setting");
    const value = parseSettingForm(key, fd);
    if (SETTINGS[key].fourEyes) {
      await requestDestructive(ctx, "security.policy", { key, value }, reauth(fd));
      return WAITING;
    }
    await svc.saveSetting(ctx, key, value as never);
    return `${SETTINGS[key].title} saved`;
  });
}

export async function revertSettingAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => `${await svc.revertSetting(ctx, req(fd, "auditId"))}: earlier values restored`);
}

// ── validation rules ──
const ruleInput = (fd: FormData) => ({ module: req(fd, "module"), brandId: opt(fd, "brandId"), name: str(fd, "name"), expression: str(fd, "expression"), message: str(fd, "message"), active: fd.get("active") === "on" });

export async function saveValidationRuleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const input = ruleInput(fd);
    if (fd.get("_intent") === "preview") {
      const p = await svc.previewValidationRule(ctx, input);
      return p.failing
        ? `Impact: ${p.failing} of the ${p.checked} most recently changed records would be refused when saved again (e.g. ${p.examples.join(", ")}). Nothing was saved.`
        : `Impact: none of the ${p.checked} most recently changed records breaks this rule. Nothing was saved.`;
    }
    await svc.saveValidationRule(ctx, opt(fd, "id"), input);
    return "Validation rule saved";
  });
}
export async function deleteValidationRuleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteValidationRule(ctx, req(fd, "id"));
    return "Validation rule deleted";
  });
}

// ── data sharing ──
const sharingInput = (fd: FormData) => ({ name: str(fd, "name"), module: req(fd, "module"), sourceTerritoryId: req(fd, "sourceTerritoryId"), targetType: req(fd, "targetType") as "ROLE" | "TERRITORY" | "USER", targetId: req(fd, "targetId"), access: (str(fd, "access") || "READ") as "READ" | "READ_WRITE" });

export async function saveSharingRuleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const input = sharingInput(fd);
    if (input.targetType === "USER") {
      const user = await findUserByEmail(input.targetId);
      if (!user) throw new BadRequestError("No active user has this e-mail address");
      input.targetId = user.id;
    }
    if (fd.get("_intent") === "preview") {
      const impact = await svc.previewSharingRule(ctx, input);
      return impact.blocked ? `${impact.summary} ${impact.blocked}` : `${impact.summary} It stays inside one brand. Nothing was saved.`;
    }
    await svc.createSharingRule(ctx, input);
    return "Sharing rule saved (not enforced yet – see the note on this page)";
  });
}
export async function deleteSharingRuleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteSharingRule(ctx, req(fd, "id"));
    return "Sharing rule deleted";
  });
}

// ── tiers ──
export async function grantSuperAdminAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.grantSuperAdmin(ctx, req(fd, "userId"), reauth(fd));
    return "Super Admin appointed";
  });
}
export async function requestRevokeSuperAdminAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await requestDestructive(ctx, "admin.revokeSuperAdmin", { userId: req(fd, "userId") }, reauth(fd));
    return WAITING;
  });
}
export async function requestDeactivateAdminAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const userId = req(fd, "userId");
    if (userId === ctx.userId) throw new ForbiddenError("You cannot deactivate yourself");
    await requestDestructive(ctx, "admin.deactivate", { userId }, reauth(fd));
    return WAITING;
  });
}
export async function grantBrandAdminAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const { user, brand } = await svc.grantBrandAdmin(ctx, req(fd, "email"), req(fd, "brandId"));
    return `${user.name} is now Brand Admin of ${brand.code}`;
  });
}
export async function revokeBrandAdminAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.revokeBrandAdmin(ctx, req(fd, "userId"), req(fd, "brandId"));
    return "Brand Admin revoked";
  });
}
export async function setSetupSectionsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.setProfileSetupSections(ctx, req(fd, "profileId"), fd.getAll("sections").map(String));
    return "Setup permissions saved";
  });
}

// ── brand team & thresholds ──
export async function addBrandMemberAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const user = await svc.addBrandMember(ctx, req(fd, "territoryId"), req(fd, "email"), fd.get("isManager") === "on");
    return `${user.name} added`;
  });
}
export async function setBrandMemberManagerAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.setBrandMemberManager(ctx, req(fd, "territoryId"), req(fd, "userId"), str(fd, "isManager") === "true");
    return "Saved";
  });
}
export async function removeBrandMemberAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.removeBrandMember(ctx, req(fd, "territoryId"), req(fd, "userId"));
    return "Removed from the territory";
  });
}
export async function saveBrandThresholdsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const brand = await svc.saveBrandThresholds(ctx, req(fd, "brandId"), { discountApprovalPct: str(fd, "discountApprovalPct"), discountEscalationPct: str(fd, "discountEscalationPct") });
    return `Thresholds of ${brand.code} saved`;
  });
}

// ── sessions ──
export async function signOutEverywhereAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const target = await findUserByEmail(req(fd, "email"));
    if (!target) throw new BadRequestError("No active user has this e-mail address");
    const user = await svc.signOutEverywhere(ctx, target.id);
    return `${user.name} is signed out on every device`;
  });
}

// ── recycle bin, mass operations, sample data ──
export async function restoreRecordsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => `${await svc.restoreFromRecycleBin(ctx, req(fd, "model"), fd.getAll("ids").map(String))} record(s) restored`);
}
export async function requestPurgeAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const ids = fd.getAll("ids").map(String);
    await requestDestructive(ctx, "recycle.purge", { model: req(fd, "model"), ...(ids.length ? { ids } : {}) }, reauth(fd));
    return WAITING;
  });
}
export async function massTransferAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const [from, to] = await Promise.all([findUserByEmail(req(fd, "fromEmail")), findUserByEmail(req(fd, "toEmail"))]);
    if (!from || !to) throw new BadRequestError("Both users must be active users (check the e-mail addresses)");
    const n = await svc.massTransfer(ctx, { module: req(fd, "module"), fromUserId: from.id, toUserId: to.id, brandId: opt(fd, "brandId") });
    return `${n} record(s) transferred from ${from.name} to ${to.name}`;
  });
}
export async function massDeleteAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const ownerEmail = opt(fd, "ownerEmail");
    const owner = ownerEmail ? await findUserByEmail(ownerEmail) : null;
    if (ownerEmail && !owner) throw new BadRequestError("No active user has this e-mail address");
    const payload = { module: req(fd, "module"), brandId: opt(fd, "brandId"), ownerId: owner?.id ?? null, createdBefore: opt(fd, "createdBefore") };
    if (fd.get("_intent") === "preview") return `Impact: ${await svc.previewMassDelete(ctx, payload)} record(s) match and would move to the recycle bin. Nothing was changed.`;
    await requestDestructive(ctx, "data.massDelete", payload, reauth(fd));
    return WAITING;
  });
}
export async function requestRemoveSampleDataAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    if (str(fd, "confirm") !== "REMOVE") throw new BadRequestError('Type REMOVE to confirm');
    await requestDestructive(ctx, "data.removeSample", {}, reauth(fd));
    return WAITING;
  });
}

// ── four-eyes inbox ──
export async function decideApprovalAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    // an explicit decision is required: a missing value must never count as "reject" (or "approve")
    const choice = str(fd, "decision");
    if (choice !== "approve" && choice !== "reject") throw new BadRequestError("Choose Approve or Reject");
    const decision = choice === "approve" ? "APPROVED" : "REJECTED";
    const res = await decideDestructive(ctx, req(fd, "requestId"), decision, reauth(fd));
    return decision === "APPROVED" ? `Approved and carried out: ${res.summary}` : "Rejected – nothing was changed";
  });
}
export async function cancelApprovalAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await cancelDestructive(ctx, req(fd, "requestId"));
    return "Request withdrawn";
  });
}

// ── configuration as code ──
export async function importConfigurationAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const file = fd.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : str(fd, "json");
    if (!text) throw new BadRequestError("Choose a configuration file or paste the JSON");
    if (text.length > 5_000_000) throw new BadRequestError("The configuration is larger than 5 MB");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError("This is not valid JSON");
    }
    if (fd.get("_intent") === "validate") {
      assertSetup(ctx, "config-as-code");
      const { problems } = await validateConfiguration(raw);
      return problems.length ? `Not importable – ${problems.length} problem(s): ${problems.slice(0, 5).join("; ")}` : "The configuration is valid for this installation. Nothing was changed.";
    }
    const applied = await importConfiguration(ctx, raw);
    return `Configuration imported: ${Object.entries(applied).map(([k, n]) => `${n} ${k}`).join(", ")}`;
  });
}

// ── own password (Personal settings / Sign-in security) ──
export async function changeOwnPasswordAction(_p: unknown, fd: FormData): Promise<Result> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const current = (fd.get("current") ?? "").toString();
    const next = (fd.get("next") ?? "").toString();
    if (next !== (fd.get("repeat") ?? "").toString()) throw new BadRequestError("The two new passwords are not the same");
    const cred = await credentialsOf(ctx.userId);
    if (!cred?.passwordHash) throw new ForbiddenError("This account signs in with Microsoft and has no password here");
    if (!(await verify(cred.passwordHash, current).catch(() => false))) throw new ForbiddenError("The current password is wrong");
    const policy = await svc.assertPasswordAllowed(next, ctx.userId);
    await unsafeSetOwnPassword(ctx.userId, await hash(next));
    await recordPasswordChange(ctx.userId, cred.passwordHash, policy.history);
    await audit({ ctx, action: "UPDATE", entity: "User", entityId: ctx.userId, after: { password: "changed by the user" } });
    revalidatePath("/security");
    return { message: "Password changed" };
  });
}
