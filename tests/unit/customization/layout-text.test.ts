import { describe, expect, it } from "vitest";
import { applyRules, layoutSchema } from "@/server/modules/customization/engine";
import { layoutToText, parseLayoutText } from "@/server/modules/customization/layout-text";

describe("layout editor notation", () => {
  const text = {
    sections: "Vehicle preferences: cf_colour, cf_trim\nFinance: cf_financeBank",
    required: "email, cf_colour",
    rules: "REQUIRE cf_financeBank WHEN paymentType eq FINANCE\nhide cf_trim WHEN cf_colour isEmpty\nSHOW cf_fleetSize WHEN source in Fleet, Referral",
  };

  it("parses sections, required fields and rules into a valid layout", () => {
    const layout = layoutSchema.parse(parseLayoutText(text));
    expect(layout.sections).toEqual([
      { title: "Vehicle preferences", fields: ["cf_colour", "cf_trim"] },
      { title: "Finance", fields: ["cf_financeBank"] },
    ]);
    expect(layout.required).toEqual(["email", "cf_colour"]);
    expect(layout.rules).toHaveLength(3);
    expect(layout.rules[1]).toEqual({ action: "HIDE", fields: ["cf_trim"], when: { field: "cf_colour", op: "isEmpty" } });
    const state = applyRules(layout, { paymentType: "FINANCE", cf_colour: "", source: "Fleet" });
    expect(state.required.has("cf_financeBank")).toBe(true);
    expect(state.hidden.has("cf_trim")).toBe(true);
    expect(state.hidden.has("cf_fleetSize")).toBe(false);
  });

  it("round-trips through the text form", () => {
    const layout = layoutSchema.parse(parseLayoutText(text));
    expect(layoutSchema.parse(parseLayoutText(layoutToText(layout)))).toEqual(layout);
  });

  it("explains what is wrong with a line", () => {
    expect(() => parseLayoutText({ sections: "no colon here", required: "", rules: "" })).toThrow(/Title: field/);
    expect(() => parseLayoutText({ sections: "", required: "", rules: "REQUIRE cf_a IF x eq 1" })).toThrow(/WHEN/);
    expect(() => parseLayoutText({ sections: "", required: "", rules: "REQUIRE cf_a WHEN x like 1" })).toThrow(/unknown operator/);
  });
});
