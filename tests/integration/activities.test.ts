import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { BadRequestError } from "@/server/errors";
import { getActivity, listActivities, overdueCount, recordActivities, teamMembers } from "@/server/modules/activities/queries";
import * as svc from "@/server/modules/activities/service";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import { convertLead, createLead } from "@/server/modules/leads/service";
import { addNote } from "@/server/modules/notes/service";
import { myNotifications } from "@/server/modules/notifications/service";
import { globalSearch } from "@/server/modules/search/queries";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let exec2: AccessContext; // second HMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let snmnl: AccessContext; // SNMNL Lagos exec
let md: AccessContext; // management
let model: { id: string };
let snmnlModel: { id: string };

beforeAll(async () => {
  I = await ids();
  [exec, exec2, bm, snmnl, md] = await Promise.all([ctxFor("exec.hmnl.1"), ctxFor("exec.hmnl.2"), ctxFor("bm.hmnl"), ctxFor("exec.snmnl.1"), ctxFor("md")]);
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, orderBy: { code: "asc" } });
  snmnlModel = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") }, orderBy: { code: "asc" } });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const newDeal = (ctx: AccessContext, brand = "HMNL") => createDeal(ctx, { name: `Act deal ${rnd()}`, brandId: I.brand(brand), regionId: I.region("Lagos") } as never);
// fixed base so that back-to-back slots touch exactly
const T0 = Date.now();
const at = (hoursFromNow: number) => new Date(T0 + hoursFromNow * 3_600_000).toISOString();
const drive = (dealId: string, vin: string, start: number, end: number, over: Record<string, unknown> = {}) =>
  ({ type: "TEST_DRIVE", parentType: "Deal", parentId: dealId, subject: `Test drive ${vin}`, startAt: at(start), endAt: at(end), vehicleVin: vin, ...over }) as never;

describe("brand inheritance and isolation", () => {
  it("an activity takes brand and region from its parent and is invisible to another brand's exec", async () => {
    const deal = await newDeal(snmnl, "SNMNL");
    const subject = `SNMNL secret call ${rnd()}`;
    const a = await svc.createActivity(snmnl, { type: "MEETING", parentType: "Deal", parentId: deal.id, subject, startAt: at(2), endAt: at(3) } as never);
    const row = await getActivity(snmnl, a.id);
    expect(row.brandId).toBe(I.brand("SNMNL"));
    expect(row.regionId).toBe(I.region("Lagos"));

    // HMNL exec: detail 404, calendar range, list, search and record panel never contain it
    await expect(getActivity(exec, a.id)).rejects.toBeInstanceOf(NotFoundError);
    const calendar = await listActivities(exec, { view: "all", ownerIds: [exec.userId, snmnl.userId], from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 7 * 86_400_000) }, {}, { take: 1000 });
    expect(calendar.rows.some((r) => r.id === a.id)).toBe(false);
    expect(calendar.rows.every((r) => r.brandId === I.brand("HMNL"))).toBe(true);
    expect((await listActivities(exec, { view: "all", q: subject })).total).toBe(0);
    expect((await globalSearch(exec, subject)).length).toBe(0);
    expect((await globalSearch(snmnl, subject)).some((h) => h.id === a.id)).toBe(true);
    await expect(recordActivities(exec, "Deal", deal.id)).resolves.toEqual({ overdue: [], upcoming: [], history: [] });
    // writes are 404 too, and so is creating an activity on the hidden deal
    await expect(svc.completeActivity(exec, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateActivity(exec, a.id, { subject: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.createActivity(exec, { type: "TASK", parentType: "Deal", parentId: deal.id, subject: "sneak", dueAt: at(1) } as never)).rejects.toBeInstanceOf(NotFoundError);
    // raw SQL through RLS
    expect(await rawAsUser(exec, `SELECT id FROM "Activity" WHERE id = '${a.id}'`)).toEqual([]);
    expect(await rawAsUser(exec, `SELECT "activityId" FROM "TestDrive" WHERE "brandId" = '${I.brand("SNMNL")}'`)).toEqual([]);
    // management sees it
    expect((await getActivity(md, a.id)).subject).toBe(subject);
  });

  it("participants must be able to see the record; a demo model must belong to the brand", async () => {
    const deal = await newDeal(exec);
    await expect(svc.createActivity(exec, { type: "MEETING", parentType: "Deal", parentId: deal.id, subject: "Mixed", startAt: at(2), endAt: at(3), participants: [snmnl.userId] } as never)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createActivity(exec, drive(deal.id, `VIN${rnd()}`.toUpperCase(), 5, 6, { productId: snmnlModel.id }))).rejects.toThrow();
    const ok = await svc.createActivity(exec, { type: "MEETING", parentType: "Deal", parentId: deal.id, subject: "With colleague", startAt: at(2), endAt: at(3), participants: [exec2.userId] } as never);
    const n = await myNotifications(exec2);
    expect(n.rows.some((r) => r.href === `/activities/${ok.id}` && r.kind === "ASSIGNED")).toBe(true);
    // notifications are private to the recipient
    expect(await rawAsUser(exec, `SELECT id FROM "Notification" WHERE "userId" = '${exec2.userId}'`)).toEqual([]);
  });

  it("a manager overlays only team members of their brand; an exec nobody", async () => {
    expect(await teamMembers(exec)).toEqual([]);
    const team = (await teamMembers(bm)).map((u) => u.id);
    expect(team).toContain(exec.userId);
    expect(team).not.toContain(snmnl.userId);
  });

  it("an account activity needs a brand context the user may write to", async () => {
    const account = await unsafeDb.account.findFirstOrThrow({ where: { deletedAt: null } });
    const base = { type: "TASK", parentType: "Account", parentId: account.id, subject: "Account follow-up", dueAt: at(4) };
    await expect(svc.createActivity(exec, base as never)).rejects.toBeInstanceOf(BadRequestError);
    await expect(svc.createActivity(exec, { ...base, brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } as never)).rejects.toBeInstanceOf(ForbiddenError);
    const a = await svc.createActivity(exec, { ...base, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    await expect(getActivity(snmnl, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("test drives", () => {
  it("rejects a double booking of the same demo vehicle, also under concurrency", async () => {
    const deal = await newDeal(exec);
    const vin = `DEMO${rnd()}`.toUpperCase();
    const first = await svc.createActivity(exec, drive(deal.id, vin, 24, 25, { productId: model.id }));
    await expect(svc.createActivity(exec2, drive((await newDeal(exec2)).id, vin, 24.5, 25.5))).rejects.toThrow(/already booked/);
    // the rejected booking leaves no orphan activity behind
    expect(await unsafeDb.activity.count({ where: { subject: `Test drive ${vin}`, deletedAt: null } })).toBe(1);
    // back-to-back and other vehicles are fine
    await svc.createActivity(exec, drive(deal.id, vin, 25, 26));
    await svc.createActivity(exec, drive(deal.id, `OTHER${rnd()}`.toUpperCase(), 24, 25));
    // rescheduling into a taken slot is rejected as well
    const later = await svc.createActivity(exec, drive(deal.id, vin, 30, 31));
    await expect(svc.updateActivity(exec, later.id, { startAt: at(24.2), endAt: at(24.8) })).rejects.toThrow(/already booked/);
    // a cancelled booking frees the slot
    await svc.completeActivity(exec, first.id, { status: "CANCELLED" });
    await svc.createActivity(exec, drive(deal.id, vin, 24, 25));

    const vin2 = `RACE${rnd()}`.toUpperCase();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.createActivity(exec, drive(deal.id, vin2, 48, 49))));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await unsafeDb.testDrive.count({ where: { vehicleVin: vin2, cancelled: false, activity: { deletedAt: null } } })).toBe(1);
  });

  it("completing a test drive moves the deal from Enquiry to Test Drive and writes stage history", async () => {
    const deal = await newDeal(exec);
    expect((await getDeal(exec, deal.id)).stageName).toBe("Enquiry");
    const a = await svc.createActivity(exec, drive(deal.id, `DRV${rnd()}`.toUpperCase(), 1, 2, { productId: model.id, licenceNumber: "LAG-1234567", licenceChecked: true }));
    const res = await svc.completeActivity(exec, a.id, { odometerStart: 100, odometerEnd: 118, feedbackRating: 5, followUpAt: at(48), outcome: "Loved it" });
    expect(res.dealAdvanced).toBe(true);
    const after = await getDeal(exec, deal.id);
    expect(after.stageName).toBe("Test Drive");
    expect(after.modelId).toBe(model.id);
    const history = await unsafeDb.dealStageHistory.findMany({ where: { dealId: deal.id }, orderBy: { at: "asc" } });
    const stages = await unsafeDb.pipelineStage.findMany({ where: { id: { in: history.map((h) => h.toStageId) } } });
    expect(history.map((h) => stages.find((x) => x.id === h.toStageId)?.key)).toEqual(["ENQUIRY", "TEST_DRIVE"]);
    expect(history[1]!.userId).toBe(exec.userId);
    // details, follow-up task and history on the record panel
    const done = await getActivity(exec, a.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.testDrive).toMatchObject({ odometerStart: 100, odometerEnd: 118, feedbackRating: 5 });
    const panel = await recordActivities(exec, "Deal", deal.id);
    expect(panel.history.map((r) => r.id)).toContain(a.id);
    expect(panel.upcoming.some((r) => r.type === "TASK" && r.subject.startsWith("Follow up test drive"))).toBe(true);
    // closing it twice is rejected
    await expect(svc.completeActivity(exec, a.id)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("a no-show does not move the deal; the licence number is masked for colleagues", async () => {
    const deal = await newDeal(exec);
    const a = await svc.createActivity(exec, drive(deal.id, `NOS${rnd()}`.toUpperCase(), 1, 2, { productId: model.id, licenceNumber: "LAG-7654321" }));
    expect((await getActivity(exec, a.id)).testDrive?.licenceNumber).toBe("LAG-7654321");
    expect((await getActivity(bm, a.id)).testDrive?.licenceNumber).toBe("LAG-7654321");
    expect((await getActivity(exec2, a.id)).testDrive?.licenceNumber).toBe("****21");
    const res = await svc.completeActivity(exec, a.id, { status: "NO_SHOW" });
    expect(res.dealAdvanced).toBe(false);
    expect((await getDeal(exec, deal.id)).stageName).toBe("Enquiry");
  });
});

describe("tasks, calls, reminders and mentions", () => {
  it("overdue tasks are counted; completing a recurring task creates the next occurrence", async () => {
    const deal = await newDeal(exec);
    const before = await overdueCount(exec);
    const t = await svc.createActivity(exec, { type: "TASK", parentType: "Deal", parentId: deal.id, subject: `Weekly check ${rnd()}`, dueAt: at(-3), recurrence: "FREQ=WEEKLY" } as never);
    expect(await overdueCount(exec)).toBe(before + 1);
    expect((await recordActivities(exec, "Deal", deal.id)).overdue.map((r) => r.id)).toEqual([t.id]);
    const res = await svc.completeActivity(exec, t.id);
    expect(await overdueCount(exec)).toBe(before);
    const next = await getActivity(exec, res.nextId!);
    expect(next.status).toBe("OPEN");
    expect(new Date(next.dueAt!).getTime() - new Date((await getActivity(exec, t.id)).dueAt!).getTime()).toBe(7 * 86_400_000);
  });

  it("a logged call is stored as completed history", async () => {
    const deal = await newDeal(exec);
    const c = await svc.logCall(exec, { parentType: "Deal", parentId: deal.id, subject: "Call", direction: "OUTBOUND", durationSec: 95, phone: "+2348000000000", disposition: "CONNECTED", outcome: "Will visit Saturday" } as never);
    const row = await getActivity(exec, c.id);
    expect(row).toMatchObject({ type: "CALL", status: "COMPLETED", durationSec: 95, disposition: "CONNECTED" });
    expect((await recordActivities(exec, "Deal", deal.id)).history.map((r) => r.id)).toEqual([c.id]);
  });

  it("due reminders become one notification for the owner", async () => {
    const deal = await newDeal(exec);
    const subject = `Remind me ${rnd()}`;
    await svc.createActivity(exec, { type: "TASK", parentType: "Deal", parentId: deal.id, subject, dueAt: at(5), reminderAt: at(-0.1) } as never);
    const system: AccessContext = { ...md, userId: "", system: true };
    expect(await svc.processReminders(system)).toBeGreaterThanOrEqual(1);
    await svc.processReminders(system);
    const mine = await myNotifications(exec, 50);
    expect(mine.rows.filter((r) => r.title === `Reminder: ${subject}`).length).toBe(1);
  });

  it("mentions notify users who can see the record and block everyone else", async () => {
    const deal = await newDeal(exec);
    await expect(addNote(exec, "Deal", deal.id, "FYI", [snmnl.userId])).rejects.toBeInstanceOf(ForbiddenError);
    expect(await unsafeDb.note.count({ where: { entityId: deal.id } })).toBe(0);
    await addNote(exec, "Deal", deal.id, "Please review the discount", [bm.userId]);
    const n = await myNotifications(bm, 50);
    expect(n.rows.some((r) => r.kind === "MENTION" && r.href === `/deals/${deal.id}#notes`)).toBe(true);
  });

  it("a converted lead's activities move to the deal", async () => {
    const lead = await createLead(exec, { firstName: "Act", lastName: `Lead ${rnd()}`, mobile: `+23480${Math.floor(10000000 + Math.random() * 89999999)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const t = await svc.createActivity(exec, { type: "TASK", parentType: "Lead", parentId: lead.id, subject: "Call back", dueAt: at(3) } as never);
    const { dealId } = await convertLead(exec, lead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "Converted with activities" } } as never);
    const moved = await getActivity(exec, t.id);
    expect(moved).toMatchObject({ parentType: "Deal", parentId: dealId });
    expect(await userId("exec.hmnl.1")).toBe(moved.ownerId);
  });
});
