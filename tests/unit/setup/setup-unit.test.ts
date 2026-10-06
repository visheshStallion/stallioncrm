import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { assertSetup, setupAccess, setupBrandIds, tierOf, visibleCatalogue } from "@/server/modules/setup/access";
import { SETUP_CATALOGUE, SETUP_CATEGORY_DEFS, findEntry, hrefOf } from "@/server/modules/setup/catalogue";
import { ExpressionError, evaluate, matches, parseExpression } from "@/server/modules/setup/expression";
import { SETTINGS, fiscalPeriod, parseRates, passwordExpired, passwordProblem, passwordPolicySchema, resolveSetting } from "@/server/modules/setup/settings";
import { renderCatalogue } from "../../../scripts/setup-catalogue";

const base: AccessContext = { userId: "u", user: { name: "U", email: "u@x.test", roleName: "R" }, scope: "TERRITORY", profile: { id: "p", name: "P", permissions: {}, fieldPermissions: {} }, memberships: [], brandIds: [], isAdmin: false };
const PERSONAS = {
  superAdmin: { ...base, scope: "ALL", isAdmin: true, isSuperAdmin: true },
  admin: { ...base, scope: "ALL", isAdmin: true },
  brandAdmin: { ...base, brandAdminOf: ["hmnl"] },
  limited: { ...base, setupSections: ["currencies", "password-policy", "admin-tiers", "users"] },
  brandManager: { ...base },
  salesExec: { ...base },
} satisfies Record<string, AccessContext>;

describe("setup catalogue", () => {
  it("is well formed: unique keys, known categories, one page per key", () => {
    const keys = SETUP_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const categories = new Set(SETUP_CATEGORY_DEFS.map((c) => c.key));
    for (const e of SETUP_CATALOGUE) {
      expect(categories.has(e.category), e.key).toBe(true);
      expect(e.tiers.length, e.key).toBeGreaterThan(0);
      expect(hrefOf(e).startsWith("/"), e.key).toBe(true);
      if (e.status === "PLANNED") expect(hrefOf(e), `${e.key}: a planned function uses the scaffold page`).toBe(`/setup/${e.key}`);
      if (e.status === "PARTIAL") expect(e.statusNote, `${e.key}: say what is missing`).toBeTruthy();
    }
    for (const c of SETUP_CATEGORY_DEFS) expect(SETUP_CATALOGUE.some((e) => e.category === c.key), c.key).toBe(true);
  });

  it("never lets Super Admin functions be delegated, and offers Brand Admins only brand-scoped pages", () => {
    for (const e of SETUP_CATALOGUE) {
      if (e.delegable) expect(e.tiers.includes("ADMIN"), `${e.key}: delegable needs the ADMIN tier`).toBe(true);
      if (e.category === "security") expect(e.delegable ?? false, `${e.key}: security is never delegable`).toBe(false);
      if (e.brandAdminReady) expect(e.tiers.includes("BRAND_ADMIN"), e.key).toBe(true);
    }
    expect(SETUP_CATALOGUE.filter((e) => e.brandAdminReady).map((e) => e.key).sort()).toEqual(["brand-members", "brand-thresholds", "document-dependencies", "document-templates", "letterhead", "print-templates", "purchase-order-settings", "templates-hub"]);
  });

  it("docs/SETUP_CATALOGUE.md is generated from the catalogue (run `pnpm setup:catalogue`)", () => {
    const file = fs.readFileSync(path.resolve(__dirname, "../../../docs/SETUP_CATALOGUE.md"), "utf8").replace(/\r\n/g, "\n");
    expect(file).toBe(renderCatalogue());
  });
});

describe("setup tiers", () => {
  it("resolves the tier of each persona", () => {
    expect(tierOf(PERSONAS.superAdmin)).toBe("SA");
    expect(tierOf(PERSONAS.admin)).toBe("ADMIN");
    expect(tierOf(PERSONAS.brandAdmin)).toBe("BRAND_ADMIN");
    expect(tierOf(PERSONAS.limited)).toBe("LIMITED");
    expect(tierOf(PERSONAS.salesExec)).toBe("USER");
    expect(tierOf({ ...PERSONAS.superAdmin, system: true })).toBe("USER");
  });

  it("matrix: every function × every persona", () => {
    for (const e of SETUP_CATALOGUE) {
      const everyone = e.tiers.includes("ALL");
      const saOnly = !e.tiers.includes("ADMIN") && !everyone;
      expect(setupAccess(PERSONAS.superAdmin, e), `SA ${e.key}`).toBe(true);
      expect(setupAccess(PERSONAS.admin, e), `ADMIN ${e.key}`).toBe(everyone || !saOnly);
      expect(setupAccess(PERSONAS.brandAdmin, e), `BA ${e.key}`).toBe(everyone || e.brandAdminReady === true);
      expect(setupAccess(PERSONAS.brandManager, e), `BM ${e.key}`).toBe(everyone);
      expect(setupAccess(PERSONAS.salesExec, e), `EXEC ${e.key}`).toBe(everyone);
    }
  });

  it("an Administrator does not get the Super Admin functions", () => {
    for (const key of ["company-details", "password-policy", "mfa", "session-settings", "data-backup", "remove-sample-data", "admin-tiers", "setup-approvals", "config-as-code"]) {
      expect(() => assertSetup(PERSONAS.admin, key), key).toThrow();
      expect(() => assertSetup(PERSONAS.superAdmin, key), key).not.toThrow();
    }
  });

  it("setup permissions of a profile open delegable functions only – never security, tiers or users", () => {
    expect(setupAccess(PERSONAS.limited, findEntry("currencies")!)).toBe(true);
    expect(setupAccess(PERSONAS.limited, findEntry("password-policy")!)).toBe(false);
    expect(setupAccess(PERSONAS.limited, findEntry("admin-tiers")!)).toBe(false);
    expect(setupAccess(PERSONAS.limited, findEntry("users")!)).toBe(false);
    expect(setupAccess(PERSONAS.limited, findEntry("fiscal-year")!)).toBe(false); // delegable, but not ticked
  });

  it("a Brand Admin's Setup scope is the own brand; an unknown function is a 404", () => {
    expect(setupBrandIds(PERSONAS.brandAdmin)).toEqual(["hmnl"]);
    expect(setupBrandIds(PERSONAS.admin)).toBeNull();
    expect(() => assertSetup(PERSONAS.superAdmin, "no-such-function")).toThrow();
    const seen = visibleCatalogue(PERSONAS.brandAdmin).flatMap((c) => c.items.map((i) => i.key)).sort();
    expect(seen).toEqual(["brand-members", "brand-thresholds", "document-dependencies", "document-templates", "letterhead", "personal-settings", "print-templates", "purchase-order-settings", "templates-hub"]);
    expect(visibleCatalogue(PERSONAS.salesExec).flatMap((c) => c.items.map((i) => i.key))).toEqual(["personal-settings"]);
  });
});

describe("validation rule formulas", () => {
  const deal = { amount: 60_000_000, financeBank: null, stage: "BOOKING", name: "HMNL SUV – Acme", email: "a@b.test", closeDate: new Date("2020-01-01"), depositAmount: "0" };

  it("evaluates comparisons, logic and functions against the record", () => {
    expect(matches("amount > 50000000 && isBlank(financeBank)", deal)).toBe(true);
    expect(matches("amount > 50000000 and not isBlank(financeBank)", deal)).toBe(false);
    expect(matches('stage == "BOOKING" && depositAmount <= 0', deal)).toBe(true);
    expect(matches('contains(name, "acme") || startsWith(name, "x")', deal)).toBe(true);
    expect(matches('in(stage, "ENQUIRY", "BOOKING")', deal)).toBe(true);
    expect(matches("closeDate < today()", deal)).toBe(true);
    expect(matches("len(name) > 100", deal)).toBe(false);
    expect(matches("(amount / 2) + 1 == 30000001", deal)).toBe(true);
    expect(matches('lower(stage) == "booking"', deal)).toBe(true);
    expect(matches("days(closeDate, today()) > 365", deal)).toBe(true);
  });

  it("treats missing values safely: no exception, ordering against nothing is false", () => {
    expect(matches("missing > 5", {})).toBe(false);
    expect(matches("isBlank(missing)", {})).toBe(true);
    expect(matches("amount / 0 > 1", deal)).toBe(false);
    expect(evaluate(parseExpression("financeBank"), deal)).toBeNull();
  });

  it("rejects anything that is not a formula: unknown fields and functions, property access, statements", () => {
    const fields = ["amount", "stage"];
    expect(() => parseExpression("amount > 1", fields)).not.toThrow();
    expect(() => parseExpression("secret > 1", fields)).toThrow(/Unknown field/);
    expect(() => parseExpression("eval(amount)", fields)).toThrow(/Unknown function/);
    for (const bad of ["amount.constructor", "amount; stage", "amount = 5", "process.exit()", "amount[0]", "`x`", "amount >", "(amount", "", "isBlank()", "a".repeat(600)]) {
      expect(() => parseExpression(bad), bad).toThrow(ExpressionError);
    }
    expect(() => parseExpression("(".repeat(40) + "1" + ")".repeat(40))).toThrow(/nested too deeply/);
  });

  it("cannot reach the prototype chain through a field name", () => {
    expect(evaluate(parseExpression("constructor"), {})).toBeNull();
    expect(evaluate(parseExpression("__proto__"), {})).toBeNull();
    expect(matches("isBlank(toString)", {})).toBe(true);
  });
});

describe("organisation settings", () => {
  it("fall back to defaults when nothing or something invalid is stored", () => {
    expect(resolveSetting("passwordPolicy", undefined).minLength).toBe(10);
    expect(resolveSetting("passwordPolicy", { minLength: 2 }).minLength).toBe(10);
    expect(resolveSetting("company", null).timeZone).toBe("Africa/Lagos");
    expect(resolveSetting("currencies", {}).home).toBe("NGN");
    expect(resolveSetting("sessionPolicy", { maxHours: 4 }).maxHours).toBe(4);
  });

  it("marks exactly the authentication policies as four-eyes", () => {
    expect(Object.entries(SETTINGS).filter(([, s]) => s.fourEyes).map(([k]) => k).sort()).toEqual(["mfaPolicy", "passwordPolicy", "sessionPolicy"]);
  });

  it("password policy: complexity, expiry", () => {
    const policy = passwordPolicySchema.parse({ minLength: 12, requireUpper: true, requireDigit: true, requireSymbol: true, expiryDays: 90 });
    expect(passwordProblem(policy, "short")).toMatch(/12 characters/);
    expect(passwordProblem(policy, "alllowercaseletters")).toMatch(/upper-case/);
    expect(passwordProblem(policy, "NoDigitsInHereAtAll")).toMatch(/digit/);
    expect(passwordProblem(policy, "NoSymbol12345678")).toMatch(/symbol/);
    expect(passwordProblem(policy, "Good!Password2026")).toBeNull();
    const now = new Date("2026-10-05T00:00:00Z");
    expect(passwordExpired(policy, new Date("2026-06-01T00:00:00Z"), now)).toBe(true);
    expect(passwordExpired(policy, new Date("2026-09-01T00:00:00Z"), now)).toBe(false);
    expect(passwordExpired(policy, null, now)).toBe(false);
    expect(passwordExpired({ ...policy, expiryDays: 0 }, new Date("2000-01-01T00:00:00Z"), now)).toBe(false);
  });

  it("fiscal periods follow the start month", () => {
    expect(fiscalPeriod(new Date("2026-02-10T00:00:00Z"), 1)).toEqual({ year: 2026, quarter: 1 });
    expect(fiscalPeriod(new Date("2026-04-10T00:00:00Z"), 4)).toEqual({ year: 2027, quarter: 1 });
    expect(fiscalPeriod(new Date("2026-03-31T00:00:00Z"), 4)).toEqual({ year: 2026, quarter: 4 });
    expect(fiscalPeriod(new Date("2026-10-05T00:00:00Z"), 7)).toEqual({ year: 2027, quarter: 2 });
  });

  it("parses exchange rates and refuses lines it does not understand", () => {
    expect(parseRates("USD = 1,550.50\n eur: 1700 \n")).toEqual({ USD: "1550.50", EUR: "1700" });
    expect(() => parseRates("dollars 5")).toThrow();
  });
});
