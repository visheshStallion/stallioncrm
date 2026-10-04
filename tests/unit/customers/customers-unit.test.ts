import { describe, expect, it } from "vitest";
import { ACCOUNT_TIERS, CONTACT_TIERS, customerTier, maskByTier, writableFields } from "@/server/access/customer-tier";
import { clusterDuplicates, matchReasons, namesSimilar, normalizeName } from "@/server/modules/customers/dedupe";
import { B, CTX } from "../../fixtures/contexts";

const bm = { ...CTX.bmHmnl, memberships: CTX.bmHmnl.memberships.map((m) => ({ ...m, isManager: true })) };
const none = { ownerId: null, hasVisibleBrandRecord: false, linkedBrandIds: [] as string[] };

describe("customer field tiers", () => {
  it("tier per viewer", () => {
    expect(customerTier(CTX.md, none)).toBe("SENSITIVE");
    expect(customerTier(CTX.admin, none)).toBe("SENSITIVE");
    expect(customerTier(CTX.lagosHmnl, none)).toBe("BASIC");
    expect(customerTier(CTX.lagosHmnl, { ...none, hasVisibleBrandRecord: true })).toBe("CONTACT");
    expect(customerTier(CTX.lagosHmnl, { ...none, ownerId: CTX.lagosHmnl.userId })).toBe("CONTACT");
    // Brand Manager of a linked brand → sensitive; of another brand → not
    expect(customerTier(bm, { ...none, linkedBrandIds: [B("HMNL")] })).toBe("SENSITIVE");
    expect(customerTier(bm, { ...none, linkedBrandIds: [B("SNMNL")] })).toBe("BASIC");
    // a sales exec with a membership in a linked brand is NOT a brand manager
    expect(customerTier(CTX.lagosHmnl, { ...none, linkedBrandIds: [B("HMNL")] })).toBe("BASIC");
  });

  const account = { name: "Acme", city: "Lagos", phone: "+2348031234521", email: "a@acme.test", address: "1 Road", creditLimit: 5, kycStatus: "VERIFIED", rcNumber: "RC1" };

  it("BASIC: masked phone, no contact or sensitive fields", () => {
    expect(maskByTier("BASIC", account, ACCOUNT_TIERS)).toEqual({ name: "Acme", city: "Lagos", phone: "+234****21", email: null, address: null, creditLimit: null, kycStatus: null, rcNumber: null });
  });
  it("CONTACT: full contact details, no sensitive fields", () => {
    expect(maskByTier("CONTACT", account, ACCOUNT_TIERS)).toEqual({ ...account, creditLimit: null, kycStatus: null, rcNumber: null });
  });
  it("SENSITIVE: everything; input never mutated", () => {
    expect(maskByTier("SENSITIVE", account, ACCOUNT_TIERS)).toEqual(account);
    expect(account.email).toBe("a@acme.test");
  });
  it("contacts: mobile masked, DOB hidden at BASIC", () => {
    expect(maskByTier("BASIC", { lastName: "X", mobile: "+2348031234521", dateOfBirth: "1990-01-01" }, CONTACT_TIERS)).toEqual({ lastName: "X", mobile: "+234****21", dateOfBirth: null });
  });
  it("writable fields follow the tier", () => {
    expect([...writableFields("BASIC", ACCOUNT_TIERS, ["name"])]).toEqual(["name"]);
    expect(writableFields("CONTACT", ACCOUNT_TIERS, ["name"]).has("email")).toBe(true);
    expect(writableFields("CONTACT", ACCOUNT_TIERS, ["name"]).has("creditLimit")).toBe(false);
    expect(writableFields("SENSITIVE", ACCOUNT_TIERS, ["name"]).has("creditLimit")).toBe(true);
  });
});

describe("duplicate matching", () => {
  it("normalises company names", () => {
    expect(normalizeName("Acme Logistics Ltd.")).toBe("acme logistics");
    expect(normalizeName("ACME  LOGISTICS NIGERIA LIMITED")).toBe("acme logistics");
  });
  it("fuzzy names: small typos match, different names do not", () => {
    expect(namesSimilar("Acme Logistics", "Acme Logistcs Ltd")).toBe(true);
    expect(namesSimilar("Acme Logistics", "Apex Logistics")).toBe(false);
    expect(namesSimilar("Jade", "Jude")).toBe(false); // too short for fuzzy
  });
  it("match rules: phone, email, RC number, name + city", () => {
    const a = { name: "Acme Logistics", city: "Lagos", phone: "+2347000001", email: "x@a.test", rcNumber: "RC1" };
    expect(matchReasons(a, { ...a })).toEqual(["phone", "email", "rcNumber", "name+city"]);
    expect(matchReasons(a, { name: "Acme Logistics Ltd", city: "lagos" })).toEqual(["name+city"]);
    expect(matchReasons(a, { name: "Acme Logistics", city: "Abuja" })).toEqual([]);
    expect(matchReasons({ name: "A", phone: null }, { name: "B", phone: null })).toEqual([]);
  });
  it("clusters transitive duplicates", () => {
    const groups = clusterDuplicates([
      { id: "1", name: "Acme Logistics", city: "Lagos", phone: "+1" },
      { id: "2", name: "Acme Logistics Ltd", city: "Lagos", email: "a@a.test" },
      { id: "3", name: "Other", city: "Kano", email: "a@a.test" },
      { id: "4", name: "Unrelated", city: "Ibadan" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.id).sort()).toEqual(["1", "2", "3"]);
    expect(groups[0]!.reasons.sort()).toEqual(["email", "name+city"]);
  });
});
