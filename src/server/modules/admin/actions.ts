"use server";

import { revalidatePath } from "next/cache";
import { MODULE_KEYS, isModuleKey } from "@/server/access/modules";
import { ACTIONS, type AccessContext } from "@/server/access/types";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as svc from "./service";
import { commitImport, dryRunImport } from "./user-import";

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

async function run(fn: (ctx: AccessContext) => Promise<FormOutcome | string | void>): Promise<Result> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const out = await fn(ctx);
    revalidatePath("/admin", "layout");
    return typeof out === "string" ? { message: out } : out ?? { message: "Saved" };
  });
}

const brandInput = (fd: FormData) => ({
  code: str(fd, "code"),
  name: str(fd, "name"),
  legalEntity: opt(fd, "legalEntity"),
  erpCompanyCode: opt(fd, "erpCompanyCode"),
  docPrefix: opt(fd, "docPrefix"),
  color: opt(fd, "color"),
  logoUrl: opt(fd, "logoUrl"),
  status: (str(fd, "status") || "ACTIVE") as "ACTIVE" | "FUTURE" | "INACTIVE",
  brandManagerId: opt(fd, "brandManagerId"),
});

// ── Brands ──
export async function createBrandAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const b = await svc.createBrand(ctx, brandInput(fd));
    return { message: `Brand ${b.code} created with its territories`, redirect: `/admin/brands/${b.id}` };
  });
}
export async function updateBrandAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.updateBrand(ctx, req(fd, "id"), brandInput(fd));
    return "Brand saved";
  });
}
export async function uploadLogoAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new BadRequestError("Choose an image file");
    await svc.setBrandLogo(ctx, req(fd, "id"), { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type });
    return "Logo uploaded";
  });
}
export async function clearLogoAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.clearBrandLogo(ctx, req(fd, "id"));
    return "Logo removed";
  });
}
export async function addAliasAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const a = await svc.addBrandAlias(ctx, { alias: str(fd, "alias"), brandId: req(fd, "brandId"), note: opt(fd, "note") });
    return `Alias ${a.alias} added`;
  });
}
export async function removeAliasAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.removeBrandAlias(ctx, req(fd, "alias"));
    return "Alias removed";
  });
}

// ── Regions ──
export async function createRegionAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const r = await svc.createRegion(ctx, { name: str(fd, "name") });
    return `Region ${r.name} added – a territory was created under every brand`;
  });
}
export async function renameRegionAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.renameRegion(ctx, req(fd, "id"), { name: str(fd, "name") });
    return "Region renamed";
  });
}
export async function setRegionActiveAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const active = str(fd, "active") === "true";
    await svc.setRegionActive(ctx, req(fd, "id"), active);
    return active ? "Region activated" : "Region deactivated";
  });
}

// ── Territories ──
export async function setTerritoryManagerAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.setTerritoryManager(ctx, req(fd, "territoryId"), opt(fd, "managerId"));
    return "Manager updated";
  });
}
export async function addMemberAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.addTerritoryMember(ctx, req(fd, "territoryId"), req(fd, "userId"), str(fd, "isManager") === "on");
    return "Member added";
  });
}
export async function removeMemberAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.removeTerritoryMember(ctx, req(fd, "territoryId"), req(fd, "userId"));
    return "Member removed";
  });
}
export async function deleteTerritoryAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteTerritory(ctx, req(fd, "territoryId"));
    return { message: "Territory deleted", redirect: "/admin/territories" };
  });
}
export async function moveRecordsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const moved = await svc.moveRecordsToTerritory(ctx, req(fd, "territoryId"), req(fd, "targetId"));
    const n = Object.values(moved).reduce((a, b) => a + b, 0);
    return `${n} record(s) moved`;
  });
}

// ── Roles ──
export async function createRoleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.createRole(ctx, { name: str(fd, "name"), parentRoleId: opt(fd, "parentRoleId") });
    return "Role created";
  });
}
export async function updateRoleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.updateRole(ctx, req(fd, "id"), { name: str(fd, "name"), parentRoleId: opt(fd, "parentRoleId") });
    return "Role saved";
  });
}
export async function deleteRoleAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.deleteRole(ctx, req(fd, "id"));
    return "Role deleted";
  });
}

// ── Profiles ──
export async function createProfileAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const p = await svc.createProfile(ctx, { name: str(fd, "name"), cloneFromId: req(fd, "cloneFromId") });
    return { message: "Profile created", redirect: `/admin/profiles/${p.id}` };
  });
}
/** Checkbox grid: inputs named `perm:<module>:<action>`. */
export async function savePermissionsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const permissions = Object.fromEntries(
      MODULE_KEYS.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, fd.get(`perm:${m}:${a}`) === "on"]))]),
    );
    await svc.updateProfilePermissions(ctx, req(fd, "id"), {
      scope: str(fd, "scope") === "ALL" ? "ALL" : "TERRITORY",
      permissions,
    });
    return "Permissions saved – users get them on their next request";
  });
}
/** Field grid: selects named `field:<name>`. */
export async function saveFieldPermissionsAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const moduleKey = req(fd, "module");
    if (!isModuleKey(moduleKey)) throw new BadRequestError("Unknown module");
    const fields: Record<string, "hidden" | "masked" | "read" | "edit"> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("field:")) fields[k.slice(6)] = v.toString() as "hidden" | "masked" | "read" | "edit";
    }
    await svc.updateFieldPermissions(ctx, req(fd, "id"), moduleKey, fields);
    return "Field security saved";
  });
}

// ── Users ──
const userInput = (fd: FormData) => ({
  name: str(fd, "name"),
  email: str(fd, "email"),
  roleId: req(fd, "roleId"),
  profileId: req(fd, "profileId"),
  managerId: opt(fd, "managerId"),
  password: opt(fd, "password"),
});

export async function createUserAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const user = await svc.createUser(ctx, userInput(fd), fd.getAll("territoryIds").map(String));
    return { message: `User ${user.name} created`, redirect: `/admin/users/${user.id}` };
  });
}
export async function updateUserAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.updateUser(ctx, req(fd, "id"), userInput(fd));
    return "User saved";
  });
}
export async function saveUserTerritoriesAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.setUserTerritories(ctx, req(fd, "id"), fd.getAll("territoryIds").map(String));
    return "Territories saved – effective on the user's next request";
  });
}
export async function setPasswordAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.setUserPassword(ctx, req(fd, "id"), str(fd, "password"));
    return "Password set";
  });
}
export async function deactivateUserAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    const lines = await svc.deactivateUser(ctx, req(fd, "id"));
    const moved = lines.filter((l) => l.targetUserId).reduce((a, l) => a + l.count, 0);
    return `User deactivated; ${moved} open record(s) reassigned`;
  });
}
export async function activateUserAction(_p: unknown, fd: FormData): Promise<Result> {
  return run(async (ctx) => {
    await svc.activateUser(ctx, req(fd, "id"));
    return "User activated";
  });
}

// ── CSV import (text is sent from the browser; nothing is stored) ──
export async function importDryRunAction(csvText: string) {
  return safeAction(async () => dryRunImport(await requireContext(), csvText));
}
export async function importCommitAction(csvText: string, overrideLines: number[]) {
  return safeAction(async () => {
    const out = await commitImport(await requireContext(), csvText, overrideLines);
    revalidatePath("/admin", "layout");
    return out;
  });
}
