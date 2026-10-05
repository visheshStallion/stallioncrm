import { describe, expect, it } from "vitest";
import { brandMonogram } from "@/components/BrandLogo";

describe("brand logo mark", () => {
  it("is built from the brand name", () => {
    expect(brandMonogram("Hyundai")).toBe("H");
    expect(brandMonogram("Nissan")).toBe("N");
    expect(brandMonogram("MG")).toBe("MG");
    expect(brandMonogram("THPL")).toBe("T");
    expect(brandMonogram("Future brand 6")).toBe("FB");
    expect(brandMonogram("  ")).toBe("?");
  });
});
