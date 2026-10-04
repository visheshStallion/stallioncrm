import { describe, expect, it } from "vitest";
import { assertCan, can } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { parseFieldPermissions, parsePermissions } from "@/server/access/permissions";
import { B, CTX, R } from "../../fixtures/contexts";

const hmnlLagos = { brandId: B("HMNL"), regionId: R("Lagos"), ownerId: "u:x" };
const snmnlLagos = { brandId: B("SNMNL"), regionId: R("Lagos"), ownerId: "u:x" };

describe("can – permission matrix (BUSINESS_CONTEXT §7)", () => {
  it.each([
    ["Lagos exec", CTX.lagosHmnl, { read: true, create: true, edit: true, export: false, massUpdate: false, delete: false, approve: false }],
    ["Abuja exec", CTX.abujaExec, { read: true, create: true, edit: true, export: false, massUpdate: false, delete: false, approve: false }],
    ["Brand manager", CTX.bmHmnl, { read: true, create: true, edit: true, export: true, massUpdate: true, delete: false, approve: true }],
    ["RSM", CTX.rsm, { read: true, create: true, edit: true, export: true, massUpdate: true, delete: false, approve: true }],
    ["Management", CTX.md, { read: true, create: false, edit: false, export: true, massUpdate: true, delete: false, approve: true }],
    ["Administrator", CTX.admin, { read: true, create: true, edit: true, export: true, massUpdate: true, delete: true, approve: false }],
  ] as const)("%s – deals", (_label, ctx, expected) => {
    for (const [action, allowed] of Object.entries(expected)) {
      expect(can(ctx, "deals", action as keyof typeof expected), action).toBe(allowed);
    }
  });

  it("only the administrator has setup", () => {
    expect(can(CTX.admin, "setup", "edit")).toBe(true);
    for (const ctx of [CTX.md, CTX.bmHmnl, CTX.rsm, CTX.lagosHmnl]) expect(can(ctx, "setup", "read")).toBe(false);
    expect(CTX.admin.isAdmin).toBe(true);
    expect(CTX.md.isAdmin).toBe(false);
  });

  it("write requires read visibility of the record", () => {
    expect(can(CTX.lagosHmnl, "deals", "edit", hmnlLagos)).toBe(true);
    expect(can(CTX.lagosHmnl, "deals", "edit", snmnlLagos)).toBe(false);
    expect(can(CTX.lagosHmnl, "deals", "read", snmnlLagos)).toBe(false);
  });

  it("create checks the target territory, not ownership", () => {
    expect(can(CTX.lagosHmnl, "deals", "create", { ...snmnlLagos, ownerId: CTX.lagosHmnl.userId })).toBe(false);
    expect(can(CTX.lagosHmnl, "deals", "create", hmnlLagos)).toBe(true);
  });
});

describe("assertCan – error types", () => {
  it("hidden record → NotFoundError (never reveals existence)", () => {
    expect(() => assertCan(CTX.lagosHmnl, "deals", "read", snmnlLagos)).toThrow(NotFoundError);
    expect(() => assertCan(CTX.lagosHmnl, "deals", "delete", snmnlLagos)).toThrow(NotFoundError);
  });

  it("visible record without permission → ForbiddenError", () => {
    expect(() => assertCan(CTX.lagosHmnl, "deals", "delete", hmnlLagos)).toThrow(ForbiddenError);
    expect(() => assertCan(CTX.md, "deals", "edit", hmnlLagos)).toThrow(ForbiddenError);
  });

  it("create outside territory → ForbiddenError", () => {
    expect(() => assertCan(CTX.lagosHmnl, "deals", "create", snmnlLagos)).toThrow(ForbiddenError);
  });

  it("passes when allowed", () => {
    expect(() => assertCan(CTX.lagosHmnl, "deals", "edit", hmnlLagos)).not.toThrow();
  });

  it("errors carry HTTP status codes", () => {
    expect(new ForbiddenError().status).toBe(403);
    expect(new NotFoundError().status).toBe(404);
  });
});

describe("permission parsing", () => {
  it("drops unknown modules and malformed values", () => {
    expect(parsePermissions({ deals: { read: true }, bogus: { read: true }, leads: "yes" })).toEqual({
      deals: { read: true },
    });
    expect(parsePermissions(null)).toEqual({});
  });

  it("drops invalid field levels", () => {
    expect(parseFieldPermissions({ accounts: { phone: "masked", email: "nope" } })).toEqual({
      accounts: { phone: "masked" },
    });
  });
});
