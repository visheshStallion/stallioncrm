import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { loadAccessContext } from "@/server/access/context";
import { createDeal } from "@/server/modules/deals/service";
import * as docs from "@/server/modules/documents/service";
import { createLead } from "@/server/modules/leads/service";
import * as notifications from "@/server/modules/notifications/service";
import { scopeHash, snapshot, syncOutbox } from "@/server/modules/offline/service";
import { globalSearch } from "@/server/modules/search/queries";
import { automationContext } from "@/server/modules/workflow/engine";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let exec2: AccessContext;
let snExec: AccessContext; // SNMNL Lagos exec
let multi: AccessContext; // HMNL + SNMNL Lagos
let bm: AccessContext;
const stamp = Date.now();

beforeAll(async () => {
  I = await ids();
  [exec, exec2, snExec, multi, bm] = (await Promise.all(["exec.hmnl.1", "exec.hmnl.2", "exec.snmnl.1", "exec.multi.1", "bm.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "NOTIFICATION_EMAILS"]) delete process.env[k];
});

const hits = async (ctx: AccessContext, q: string) => (await globalSearch(ctx, q)).map((h) => `${h.module}:${h.title}`);

describe("global search", () => {
  it("an SNMNL VIN, document number or customer is not found by an HMNL executive – on any path", async () => {
    const vin = `SNVIN${stamp}`.slice(0, 17).toUpperCase();
    const snDeal = await createDeal(snExec, { name: `Secret SNMNL deal ${stamp}`, customerName: `Zebra Holdings ${stamp}`, brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), vinChassisNo: vin } as never);
    const quote = await docs.createQuoteFromDeal(snExec, snDeal.id);
    const number = (await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id } })).number;
    const snUnit = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: I.brand("SNMNL"), status: "AVAILABLE" } });

    for (const q of [vin, vin.slice(0, 9), `Secret SNMNL deal ${stamp}`, `Zebra Holdings ${stamp}`, number, snUnit.vin, snUnit.vin.slice(-6)]) {
      // (a fragment may also match one of the executive's own HMNL records – what matters is that nothing of SNMNL comes back)
      const found = await globalSearch(exec, q);
      expect(found.filter((h) => h.brandId === I.brand("SNMNL") || h.module === "inventory" || h.title.includes(String(stamp))), `"${q}" as HMNL exec`).toEqual([]);
    }
    // the SNMNL executive finds all of it
    expect(await hits(snExec, vin)).toEqual(expect.arrayContaining([`deals:Secret SNMNL deal ${stamp}`]));
    expect(await hits(snExec, number)).toEqual(expect.arrayContaining([`quotes:${number}`]));
    expect(await hits(snExec, `Zebra Holdings ${stamp}`)).toEqual(expect.arrayContaining([`deals:Secret SNMNL deal ${stamp}`, `quotes:${number}`]));
    // sales users find stock by the last six characters of the VIN only, and see it masked
    expect((await globalSearch(snExec, snUnit.vin.slice(-6))).filter((h) => h.module === "inventory").map((h) => h.title)).toEqual([`${"•".repeat(11)}${snUnit.vin.slice(-6)}`]);
    expect((await globalSearch(snExec, snUnit.vin.slice(0, 8))).filter((h) => h.module === "inventory")).toEqual([]);
    // a rep of both brands finds the deal; results carry the record's brand
    const both = await globalSearch(multi, vin);
    expect(both.map((h) => h.brandId)).toEqual([I.brand("SNMNL")]);
  });

  it("finds own records by name, phone, document number and VIN using the trigram indexes", async () => {
    const lead = await createLead(exec, { firstName: "Quentin", lastName: `Searchable${stamp}`, mobile: `0803${String(stamp).slice(-7)}`, source: "WALK_IN", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    expect((await globalSearch(exec, `searchable${stamp}`)).map((h) => h.id)).toContain((lead as { id: string }).id);
    expect((await globalSearch(exec, String(stamp).slice(-7))).map((h) => h.id)).toContain((lead as { id: string }).id);
    const product = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL"), category: "VEHICLE" } });
    expect(await hits(exec, product.code)).toContain(`products:${product.name}`);
    expect(await globalSearch(exec, "x")).toEqual([]); // too short
    const indexes = await unsafeDb.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_trgm'`;
    expect(indexes.map((i) => i.indexname)).toEqual(expect.arrayContaining(["Deal_vin_trgm", "Quote_number_trgm", "VehicleUnit_vin_trgm", "Lead_mobile_trgm"]));
  });
});

describe("offline snapshot and outbox", () => {
  it("contains only the user's own visible records and changes its fingerprint when a territory is removed", async () => {
    const mine = await createDeal(multi, { name: `Offline HMNL ${stamp}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    const other = await createDeal(multi, { name: `Offline SNMNL ${stamp}`, brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } as never);
    await createDeal(exec2, { name: `Colleague deal ${stamp}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    const before = await snapshot(multi);
    const dealIds = before.deals.map((d) => d.id);
    expect(dealIds).toEqual(expect.arrayContaining([mine.id, other.id]));
    expect(before.deals.some((d) => d.name === `Colleague deal ${stamp}`)).toBe(false); // visible online, but not "mine"
    expect(before.userId).toBe(multi.userId);
    expect(JSON.stringify(before)).not.toMatch(/purchaseCost|passwordHash/);

    // the SNMNL territory is taken away: the fingerprint changes and SNMNL records are gone from the snapshot
    const snTerritory = await unsafeDb.territory.findFirstOrThrow({ where: { brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } });
    await unsafeDb.territoryMember.delete({ where: { userId_territoryId: { userId: multi.userId, territoryId: snTerritory.id } } });
    // (by the visibility rule an owner keeps seeing records they own, so the administrator also hands the SNMNL deal over)
    await unsafeDb.deal.update({ where: { id: other.id }, data: { ownerId: snExec.userId } });
    const reduced = (await loadAccessContext(multi.userId))!;
    expect(scopeHash(reduced)).not.toBe(before.scopeHash);
    const after = await snapshot(reduced);
    expect(after.scopeHash).not.toBe(before.scopeHash);
    expect(after.deals.map((d) => d.id)).toContain(mine.id);
    expect(after.deals.map((d) => d.id)).not.toContain(other.id);
    // an action recorded offline on the SNMNL deal is refused now – with the user's CURRENT access
    const [conflict, ok] = await syncOutbox(reduced, [
      { key: `k1-${stamp}`, type: "note.add", payload: { entity: "Deal", entityId: other.id, body: "Recorded while offline" } },
      { key: `k2-${stamp}`, type: "note.add", payload: { entity: "Deal", entityId: mine.id, body: "Recorded while offline" } },
    ]);
    expect(conflict).toMatchObject({ status: "conflict", message: "The record is no longer available to you" });
    expect(ok).toMatchObject({ status: "ok" });
    expect(await unsafeDb.note.count({ where: { entity: "Deal", entityId: other.id } })).toBe(0);
    await unsafeDb.territoryMember.create({ data: { userId: multi.userId, territoryId: snTerritory.id } });
    // same access again → same fingerprint as before (the cache is only wiped when access really changed)
    expect(scopeHash((await loadAccessContext(multi.userId))!)).toBe(before.scopeHash);
  });

  it("applies each offline action once and reports validation errors", async () => {
    const deal = await createDeal(exec, { name: `Outbox deal ${stamp}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    const ops = [
      { key: `call-${stamp}`, type: "call.log", payload: { parentType: "Deal", parentId: deal.id, outcome: "Customer wants a test drive" }, at: new Date(Date.now() - 3_600_000).toISOString() },
      { key: `lead-${stamp}`, type: "lead.create", payload: { lastName: `Offline${stamp}`, mobile: `0805${String(stamp).slice(-7)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } },
      { key: `bad-${stamp}`, type: "lead.create", payload: { lastName: "", mobile: "1", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } },
      { key: `foreign-${stamp}`, type: "lead.create", payload: { lastName: "Smuggled", mobile: "08031112222", brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } },
    ];
    const first = await syncOutbox(exec, ops);
    expect(first.map((r) => r.status)).toEqual(["ok", "ok", "error", "conflict"]);
    const again = await syncOutbox(exec, ops.slice(0, 2));
    expect(again.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(again[1]!.id).toBe(first[1]!.id);
    expect(await unsafeDb.lead.count({ where: { lastName: `Offline${stamp}` } })).toBe(1);
    const call = await unsafeDb.activity.findFirstOrThrow({ where: { parentType: "Deal", parentId: deal.id, type: "CALL" } });
    expect(call).toMatchObject({ status: "COMPLETED", ownerId: exec.userId, brandId: I.brand("HMNL") });
    expect(await unsafeDb.lead.count({ where: { lastName: "Smuggled" } })).toBe(0);
    // another user's replay of the same key is a different operation (keys are per user)
    await expect(syncOutbox(exec, "nope")).rejects.toThrow(/up to 100/);
  });
});

describe("notifications", () => {
  const jobs = (type: string, since: Date) => unsafeDb.job.findMany({ where: { type, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });

  it("respects each recipient's channels and quiet hours; push goes only to the addressed users", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    process.env.NOTIFICATION_EMAILS = "1";
    const [u1, u2, u3] = await Promise.all([userId("exec.hmnl.1"), userId("exec.hmnl.2"), userId("exec.snmnl.1")]);
    // exec2: no push for approvals, and nothing in the app for mentions
    await notifications.saveNotificationPrefs(exec2, { kinds: { APPROVAL: { inApp: true, email: true, push: false }, MENTION: { inApp: false, email: false, push: false } }, quietFrom: null, quietTo: null, digest: false });
    const since = new Date();
    await notifications.notify(bm, [u1, u2], { kind: "APPROVAL", title: `Approve ${stamp}`, href: "/approvals" });
    const push = await jobs("push.send", since);
    expect(push).toHaveLength(1);
    expect(push[0]!.payload).toEqual({ userIds: [u1], title: `Approve ${stamp}`, href: "/approvals" }); // title and link only – no record data
    const mail = await jobs("email.users", since);
    expect((mail[0]!.payload as { userIds: string[] }).userIds.sort()).toEqual([u1, u2].sort());
    expect(await unsafeDb.notification.count({ where: { title: `Approve ${stamp}` } })).toBe(2);
    expect(await unsafeDb.notification.count({ where: { title: `Approve ${stamp}`, userId: u3 } })).toBe(0); // nobody else

    await notifications.notify(bm, [u2], { kind: "MENTION", title: `Mention ${stamp}` });
    expect(await unsafeDb.notification.count({ where: { title: `Mention ${stamp}` } })).toBe(0);

    // quiet hours around the clock for exec: in-app only
    await notifications.saveNotificationPrefs(exec, { kinds: {}, quietFrom: "00:00", quietTo: "23:59", digest: false });
    const quietSince = new Date();
    await notifications.notify(bm, [u1], { kind: "ASSIGNED", title: `Quiet ${stamp}` });
    expect(await jobs("push.send", quietSince)).toHaveLength(0);
    expect(await jobs("email.users", quietSince)).toHaveLength(0);
    expect(await unsafeDb.notification.count({ where: { title: `Quiet ${stamp}`, userId: u1 } })).toBe(1);
    await expect(notifications.saveNotificationPrefs(exec, { kinds: {}, quietFrom: "22:00", quietTo: null })).rejects.toThrow(/both the start and the end/);
    await notifications.saveNotificationPrefs(exec, { kinds: {}, quietFrom: null, quietTo: null, digest: false });
    for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "NOTIFICATION_EMAILS"]) delete process.env[k];
  });

  it("push subscriptions are private to their user; a device that changes user stops delivering to the previous one", async () => {
    const sub = { endpoint: `https://push.example.test/send/${stamp}`, keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } };
    await notifications.savePushSubscription(exec, sub, "test-agent");
    expect(await notifications.myPushSubscriptions(exec)).toBe(1);
    expect(await rawAsUser(exec2, `SELECT id FROM "PushSubscription"`)).toEqual([]);
    expect((await rawAsUser(exec, `SELECT id FROM "PushSubscription"`)).length).toBe(1);
    await notifications.savePushSubscription(exec2, sub, "test-agent"); // same browser, next user
    expect(await notifications.myPushSubscriptions(exec)).toBe(0);
    expect(await notifications.myPushSubscriptions(exec2)).toBe(1);
    await expect(notifications.savePushSubscription(exec, { endpoint: "http://insecure.example/x", keys: sub.keys }, null)).rejects.toThrow(/Invalid push subscription/);
    // without VAPID keys nothing is sent
    expect(await notifications.sendPush({ payload: { userIds: [exec2.userId], title: "x", href: "/" } })).toEqual({ skipped: "web push is not configured" });
    await notifications.removePushSubscription(exec2, sub.endpoint);
    expect(await notifications.myPushSubscriptions(exec2)).toBe(0);
  });

  it("the notification centre shows only the user's own notifications; daily digest once; stale deals once", async () => {
    await notifications.notify(bm, [exec.userId], { kind: "INFO", title: `Mine ${stamp}`, href: "/deals" });
    await notifications.notify(bm, [exec2.userId], { kind: "INFO", title: `Theirs ${stamp}` });
    const list = await notifications.listNotifications(exec, {}, { take: 200 });
    expect(list.rows.some((r) => r.title === `Mine ${stamp}`)).toBe(true);
    expect(list.rows.some((r) => r.title === `Theirs ${stamp}`)).toBe(false);
    expect((await notifications.listNotifications(exec, { kind: "APPROVAL" }, { take: 200 })).rows.every((r) => r.kind === "APPROVAL")).toBe(true);
    const mine = list.rows.find((r) => r.title === `Mine ${stamp}`)!;
    await notifications.markRead(exec2, mine.id); // someone else's id: no effect
    expect((await unsafeDb.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).toBeNull();
    await notifications.markRead(exec, mine.id);
    expect((await unsafeDb.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).not.toBeNull();

    // digest: only for users who asked, once per day, after 07:00 Lagos
    await notifications.saveNotificationPrefs(exec2, { kinds: {}, quietFrom: null, quietTo: null, digest: true });
    const morning = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00+01:00`);
    expect(await notifications.sendDigests(new Date(`${new Date().toISOString().slice(0, 10)}T05:00:00+01:00`))).toBe(0);
    const at = new Date(Math.max(morning.getTime(), Date.now()));
    const since = new Date();
    expect(await notifications.sendDigests(at)).toBe(1);
    expect(await notifications.sendDigests(at)).toBe(0);
    const [digest] = await unsafeDb.job.findMany({ where: { type: "email.users", createdAt: { gte: since } } });
    expect(digest!.payload).toMatchObject({ userIds: [exec2.userId] });
    expect(String((digest!.payload as { text: string }).text)).toContain(`Theirs ${stamp}`);
    expect(String((digest!.payload as { text: string }).text)).not.toContain(`Mine ${stamp}`);

    // stale deals: the owner is told once
    const stale = await createDeal(exec, { name: `Stale ${stamp}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    await unsafeDb.$executeRaw`UPDATE "Deal" SET "updatedAt" = now() - interval '20 days' WHERE id = ${stale.id}`;
    const ctx = (brandId: string) => automationContext(brandId);
    await notifications.notifyStaleDeals(ctx);
    await notifications.notifyStaleDeals(ctx);
    const told = await unsafeDb.notification.findMany({ where: { kind: "STALE_DEAL", href: `/deals/${stale.id}` } });
    expect(told.map((t) => t.userId)).toEqual([exec.userId]);
  });
});
