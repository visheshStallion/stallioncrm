import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AccessContext } from "@/server/access/types";
import { deriveEvents } from "@/server/integrations/events";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";

describe("API paging", () => {
  it("walks a list with cursors", () => {
    const first = parseApiPaging({ limit: "50" });
    expect(first).toEqual({ page: 1, per: 50, skip: 0 });
    const meta = listMeta(120, first);
    expect(meta).toMatchObject({ total: 120, per: 50 });
    const second = parseApiPaging({ cursor: meta.nextCursor!, limit: "50" });
    expect(second).toEqual({ page: 2, per: 50, skip: 50 });
    const third = parseApiPaging({ cursor: listMeta(120, second).nextCursor!, limit: "50" });
    expect(listMeta(120, third).nextCursor).toBeNull();
  });

  it("clamps the limit, keeps page/per and rejects forged cursors", () => {
    expect(parseApiPaging({ limit: "9999" }).per).toBe(200);
    expect(parseApiPaging({ page: "3", per: "20" })).toEqual({ page: 3, per: 20, skip: 40 });
    expect(() => parseApiPaging({ cursor: "not-a-cursor" })).toThrow(/Invalid cursor/);
    expect(() => parseApiPaging({ cursor: Buffer.from(JSON.stringify({ o: -5 })).toString("base64url") })).toThrow(/Invalid cursor/);
  });
});

describe("business events", () => {
  it("derives events from writes", () => {
    expect(deriveEvents("Lead", "create", null, {})).toEqual(["lead.created"]);
    expect(deriveEvents("Deal", "update", { stageId: "a" }, { stageId: "b" })).toEqual(["deal.stage_changed"]);
    expect(deriveEvents("Deal", "update", { stageId: "a" }, { stageId: "a", amount: 5 })).toEqual([]);
    expect(deriveEvents("SalesOrder", "update", { status: "DRAFT" }, { status: "CONFIRMED" })).toEqual(["salesorder.confirmed"]);
    expect(deriveEvents("SalesOrder", "update", { status: "CONFIRMED" }, { status: "CONFIRMED" })).toEqual([]);
    expect(deriveEvents("Invoice", "update", { status: "DRAFT" }, { status: { set: "ISSUED" } })).toEqual(["invoice.issued"]);
    expect(deriveEvents("Invoice", "update", { status: "PART_PAID" }, { status: "PAID", amountPaid: 10 })).toEqual(["invoice.paid"]);
    expect(deriveEvents("Case", "update", { status: "NEW" }, { status: "RESOLVED" })).toEqual(["case.resolved"]);
    expect(deriveEvents("Quote", "create", null, {})).toEqual([]);
  });
});

describe("token brand restriction", () => {
  const ctx = (over: Partial<AccessContext>): AccessContext => ({
    userId: "u",
    user: { name: "U", email: "u@example.test", roleName: "R" },
    scope: "TERRITORY",
    profile: { id: "p", name: "P", permissions: {}, fieldPermissions: {} },
    memberships: [
      { territoryId: "t1", brandId: "A", regionId: "r1", isManager: false },
      { territoryId: "t2", brandId: "B", regionId: null, isManager: true },
    ],
    brandIds: ["A", "B"],
    isAdmin: false,
    ...over,
  });

  it("only ever narrows", async () => {
    vi.mock("@/server/db", () => ({}));
    vi.mock("@/server/db/api-store", () => ({}));
    vi.mock("@/server/access/context", () => ({}));
    vi.mock("@/server/modules/admin/service", () => ({}));
    const { restrictToBrands } = await import("@/server/modules/api/tokens");
    expect(restrictToBrands(ctx({}), [])).toMatchObject({ brandIds: ["A", "B"] });
    const narrowed = restrictToBrands(ctx({}), ["B", "Z"]);
    expect(narrowed.brandIds).toEqual(["B"]); // Z is not the user's brand: ignored, never added
    expect(narrowed.memberships).toEqual([{ territoryId: "t2", brandId: "B", regionId: null, isManager: true }]);
    const all = restrictToBrands(ctx({ scope: "ALL", memberships: [], brandIds: ["A", "B", "C"], isAdmin: true }), ["C"]);
    expect(all).toMatchObject({ scope: "TERRITORY", brandIds: ["C"], isAdmin: false });
    expect(all.memberships).toEqual([{ territoryId: "token:C", brandId: "C", regionId: null, isManager: false }]);
  });
});
