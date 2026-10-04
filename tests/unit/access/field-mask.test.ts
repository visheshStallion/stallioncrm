import { describe, expect, it } from "vitest";
import { fieldAccess, fieldMask, maskEmail, maskPhone } from "@/server/access/field-mask";
import { CTX } from "../../fixtures/contexts";

describe("fieldMask", () => {
  const customer = {
    id: "a1",
    name: "Acme Logistics",
    city: "Lagos",
    phone: "08031234521",
    email: "buyer@acme.test",
    address: "1 Fake Street",
    creditLimit: 5_000_000,
  };

  it("masks phone as 0803****21", () => {
    expect(maskPhone("08031234521")).toBe("0803****21");
    expect(maskPhone("123")).toBe("****");
  });

  it("masks email", () => {
    expect(maskEmail("buyer@acme.test")).toBe("b***@acme.test");
  });

  const restricted = {
    ...CTX.lagosHmnl,
    profile: {
      ...CTX.lagosHmnl.profile,
      fieldPermissions: { accounts: { phone: "masked", email: "hidden", address: "hidden", creditLimit: "hidden" } as const },
    },
  };

  it("profile field permissions hide / mask fields", () => {
    const out = fieldMask(restricted, "accounts", customer);
    expect(out).toEqual({ id: "a1", name: "Acme Logistics", city: "Lagos", phone: "0803****21" });
    expect(customer.email).toBe("buyer@acme.test"); // input not mutated
  });

  it("management sees full customer record", () => {
    expect(fieldMask(CTX.md, "accounts", customer)).toEqual(customer);
  });

  it("unconfigured fields are editable", () => {
    expect(fieldAccess(restricted, "accounts", "name")).toBe("edit");
    expect(fieldAccess(restricted, "accounts", "email")).toBe("hidden");
  });
});
