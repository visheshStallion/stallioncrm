import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { recordSurvey } from "@/server/db/cases-system";
import { BadRequestError } from "@/server/errors";
import { recordActivities } from "@/server/modules/activities/queries";
import { createActivity } from "@/server/modules/activities/service";
import * as admin from "@/server/modules/cases/admin";
import { addBusinessHours } from "@/server/modules/cases/business-hours";
import { getCase, listCases, loadCalendar, queueCounts } from "@/server/modules/cases/queries";
import * as svc from "@/server/modules/cases/service";
import { convertLead, createLead } from "@/server/modules/leads/service";
import { sandboxOutbox } from "@/server/modules/messaging/providers";
import { receiveInbound } from "@/server/modules/messaging/service";
import { addNote, listNotes } from "@/server/modules/notes/service";
import { myNotifications } from "@/server/modules/notifications/service";
import { definitionSchema } from "@/server/modules/reports/definition";
import { runReport } from "@/server/modules/reports/engine";
import { runSavedReport } from "@/server/modules/reports/service";
import { globalSearch } from "@/server/modules/search/queries";
import { runDueJobs, runScheduler } from "@/server/modules/workflow/engine";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos agent
let exec2: AccessContext;
let snmnl: AccessContext; // SNMNL Lagos agent
let bm: AccessContext; // HMNL Brand Manager
let bmSnmnl: AccessContext;
let hos: AccessContext;
let adminCtx: AccessContext;
const year = new Date().getUTCFullYear();
const rnd = () => Math.random().toString(36).slice(2, 8);
const phone = () => `+23480${String(60000000 + Math.floor(Math.random() * 9_000_000))}`;

beforeAll(async () => {
  I = await ids();
  [exec, exec2, snmnl, bm, bmSnmnl, hos, adminCtx] = (await Promise.all(["exec.hmnl.1", "exec.hmnl.2", "exec.snmnl.1", "bm.hmnl", "bm.snmnl", "hos", "admin"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { fromName: "HMNL Care", fromEmail: "care@hmnl.example.test", smsSenderId: "HMNL", whatsappNumber: "+2348100000011" } });
});

const newCase = (ctx: AccessContext, brand: string, over: Record<string, unknown> = {}) =>
  svc.createCase(ctx, { subject: `Case ${rnd()}`, description: "Customer reports a problem", brandId: I.brand(brand), regionId: I.region("Lagos"), customerName: "Chika Obi", customerEmail: `chika.${rnd()}@example.test`, ...over } as never);
async function drain() {
  for (let i = 0; i < 30; i++) {
    const { done, failed } = await runDueJobs(100);
    if (done + failed === 0) break;
  }
}

describe("numbering per brand", () => {
  it("is {prefix}-CS-{year}-{seq}, sequential per brand under concurrency, and immutable", async () => {
    const before = await unsafeDb.case.count({ where: { brandId: I.brand("HMNL") } });
    const created = await Promise.all(Array.from({ length: 6 }, () => newCase(exec, "HMNL")));
    expect(created.map((c) => c.number).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `HMNL-CS-${year}-${String(before + i + 1).padStart(5, "0")}`));
    const other = await newCase(snmnl, "SNMNL");
    expect(other.number).toBe(`SNMNL-CS-${year}-${String(await unsafeDb.case.count({ where: { brandId: I.brand("SNMNL") } })).padStart(5, "0")}`);
    await expect(unsafeDb.case.update({ where: { id: created[0]!.id }, data: { number: "X-1" } })).rejects.toThrow(/cannot be changed/);
    // the case can be opened by its number as well
    expect((await getCase(exec, created[0]!.number)).id).toBe(created[0]!.id);
  });
});

describe("brand isolation", () => {
  it("an HMNL agent cannot see, find, change or create SNMNL cases", async () => {
    const s = await newCase(snmnl, "SNMNL", { subject: `SNMNL gearbox complaint ${rnd()}` });
    const sRow = await getCase(snmnl, s.id);
    await expect(getCase(exec, s.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCase(exec, s.number)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateCase(exec, s.id, { subject: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.changeCaseStatus(exec, s.id, { status: "IN_PROGRESS" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.assignCase(exec, s.id)).rejects.toBeInstanceOf(NotFoundError);
    for (const queue of ["my", "unassigned", "breaching", "open", "all"]) {
      const { rows } = await listCases(exec, { queue }, {}, { take: 500 });
      expect(rows.every((r) => r.brandId === I.brand("HMNL")), queue).toBe(true);
    }
    expect(await globalSearch(exec, sRow.subject)).toEqual([]);
    expect((await globalSearch(snmnl, sRow.number)).some((h) => h.id === s.id)).toBe(true);
    expect(await rawAsUser(exec, `SELECT id FROM "Case" WHERE "brandId" = '${I.brand("SNMNL")}'`)).toEqual([]);
    // creating: another brand → 403; on another brand's deal → 404
    await expect(newCase(exec, "SNMNL")).rejects.toBeInstanceOf(ForbiddenError);
    const sLead = await createLead(snmnl, { firstName: "S", lastName: `Cust ${rnd()}`, mobile: phone(), brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const sDeal = await convertLead(snmnl, sLead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "SNMNL deal" } } as never);
    await expect(svc.createCase(exec, { subject: "sneak", dealId: sDeal.dealId } as never)).rejects.toBeInstanceOf(NotFoundError);
    // children of a case (notes, activities) inherit its brand and are just as invisible
    await addNote(snmnl, "Case", s.id, "Spoke to the workshop");
    const task = await createActivity(snmnl, { type: "TASK", parentType: "Case", parentId: s.id, subject: "Call customer back", dueAt: new Date(Date.now() + 3_600_000).toISOString() } as never);
    expect((await listNotes(snmnl, "Case", s.id)).length).toBe(1);
    await expect(listNotes(exec, "Case", s.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await rawAsUser(exec, `SELECT id FROM "Activity" WHERE id = '${task.id}'`)).toEqual([]);
    expect((await recordActivities(snmnl, "Case", s.id)).upcoming.map((a) => a.id)).toEqual([task.id]);
    // management sees both brands
    expect((await getCase(hos, s.id)).brandId).toBe(I.brand("SNMNL"));
  });

  it("a case on a deal takes brand, region and customer from the deal; the deal must stay in the brand", async () => {
    const lead = await createLead(exec, { firstName: "Deal", lastName: `Cust ${rnd()}`, mobile: phone(), email: `deal.${rnd()}@example.test`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const conv = await convertLead(exec, lead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "Delivered car" } } as never);
    const c = await svc.createCase(exec, { subject: "Number plates not delivered", type: "DOCUMENTATION", dealId: conv.dealId, brandId: I.brand("SNMNL") } as never);
    const row = await getCase(exec, c.id);
    expect(row).toMatchObject({ brandId: I.brand("HMNL"), regionId: I.region("Lagos"), dealId: conv.dealId, accountId: conv.accountId, contactId: conv.contactId, ownerId: exec.userId, unassigned: false });
    const sLead = await createLead(snmnl, { firstName: "S", lastName: `Cust ${rnd()}`, mobile: phone(), brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const sDeal = await convertLead(snmnl, sLead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "Other brand" } } as never);
    await expect(svc.updateCase(hos, c.id, { dealId: sDeal.dealId })).rejects.toBeInstanceOf(ForbiddenError); // management profile cannot edit cases
    await expect(unsafeDb.case.update({ where: { id: c.id }, data: { dealId: sDeal.dealId } })).rejects.toThrow(/another brand/);
  });
});

describe("SLA", () => {
  it("due times follow the brand's policy in business hours", async () => {
    const policy = await unsafeDb.slaPolicy.findUniqueOrThrow({ where: { brandId_priority: { brandId: I.brand("HMNL"), priority: "URGENT" } } });
    expect(policy).toMatchObject({ firstResponseHours: 1, resolutionHours: 8, escalateToRole: "Brand Manager" });
    const before = new Date();
    const c = await newCase(exec, "HMNL", { priority: "URGENT" });
    const row = await unsafeDb.case.findUniqueOrThrow({ where: { id: c.id } });
    const calendar = await loadCalendar(exec);
    const near = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) < 90_000;
    expect(near(row.firstResponseDueAt!, addBusinessHours(before, 1, calendar))).toBe(true);
    expect(near(row.slaDueAt!, addBusinessHours(before, 8, calendar))).toBe(true);
    // changing the priority recalculates from the creation time
    await svc.updateCase(exec, c.id, { priority: "LOW" });
    const low = await unsafeDb.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(near(low.slaDueAt!, addBusinessHours(row.createdAt, 45, calendar))).toBe(true);
    // policies: the brand's manager changes them, nobody else
    await admin.saveSlaPolicy(bm, I.brand("HMNL"), "HIGH", { firstResponseHours: 1, resolutionHours: 12, escalateToRole: "Brand Manager" });
    await expect(admin.saveSlaPolicy(bm, I.brand("SNMNL"), "HIGH", { firstResponseHours: 1, resolutionHours: 12 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin.saveSlaPolicy(exec, I.brand("HMNL"), "HIGH", { firstResponseHours: 1, resolutionHours: 12 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin.saveSlaPolicy(bm, I.brand("HMNL"), "HIGH", { firstResponseHours: 20, resolutionHours: 12 })).rejects.toBeInstanceOf(BadRequestError);
    await expect(rawAsUser(exec, `UPDATE "SlaPolicy" SET "resolutionHours" = 1 RETURNING id`)).resolves.toEqual([]);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "SlaPolicy" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
  });

  it("a breached case is escalated to the Brand Manager of ITS brand – once", async () => {
    const h = await newCase(exec, "HMNL", { subject: `Breached HMNL ${rnd()}` });
    const s = await newCase(snmnl, "SNMNL", { subject: `Breached SNMNL ${rnd()}` });
    const fine = await newCase(exec, "HMNL");
    const past = new Date(Date.now() - 3_600_000);
    await unsafeDb.case.updateMany({ where: { id: { in: [h.id, s.id] } }, data: { slaDueAt: past, firstResponseDueAt: past } });
    expect((await listCases(exec, { queue: "breaching" }, {}, { take: 500 })).rows.map((r) => r.id)).toContain(h.id);
    expect((await getCase(exec, h.id)).sla).toBe("breached");

    expect(await runScheduler()).toBeGreaterThanOrEqual(2);
    await drain();
    const [hRow, sRow, fRow] = await Promise.all([h, s, fine].map((c) => unsafeDb.case.findUniqueOrThrow({ where: { id: c.id } })));
    expect(hRow).toMatchObject({ status: "ESCALATED" });
    expect(hRow!.escalatedAt).not.toBeNull();
    expect(sRow!.status).toBe("ESCALATED");
    expect(fRow!.status).toBe("NEW");
    const got = async (ctx: AccessContext, id: string) => (await myNotifications(ctx, 200)).rows.filter((n) => n.href === `/cases/${id}` && n.title.startsWith("SLA breached")).length;
    expect(await got(bm, h.id)).toBe(1);
    expect(await got(bmSnmnl, h.id)).toBe(0); // the other brand's manager is never told
    expect(await got(bmSnmnl, s.id)).toBe(1);
    expect(await got(bm, s.id)).toBe(0);
    expect(await got(exec, h.id)).toBe(1); // the owner is informed too
    // idempotent
    await runScheduler();
    await drain();
    expect(await got(bm, h.id)).toBe(1);

    // the policy decides the role: Head of Sales for LOW priority HMNL cases
    await admin.saveSlaPolicy(bm, I.brand("HMNL"), "LOW", { firstResponseHours: 9, resolutionHours: 45, escalateToRole: "Head of Sales" });
    const low = await newCase(exec, "HMNL", { priority: "LOW" });
    await unsafeDb.case.update({ where: { id: low.id }, data: { slaDueAt: past } });
    await runScheduler();
    await drain();
    expect(await got(hos, low.id)).toBe(1);
    expect(await got(bm, low.id)).toBe(0);
  });
});

describe("working a case", () => {
  it("status flow: first response, resolution required, survey on close, reopen by a manager", async () => {
    const email = `survey.${rnd()}@example.test`;
    const c = await newCase(exec, "HMNL", { customerEmail: email, customerName: "Ngozi Eke" });
    await expect(svc.changeCaseStatus(exec, c.id, { status: "RESOLVED" })).rejects.toThrow(/resolution/);
    await svc.changeCaseStatus(exec, c.id, { status: "IN_PROGRESS" });
    let row = await getCase(exec, c.id);
    expect(row.firstRespondedAt).not.toBeNull();
    expect(row.firstResponse).toBe("met");
    await svc.changeCaseStatus(exec, c.id, { status: "RESOLVED", resolution: "Replaced the part under warranty" });
    row = await getCase(exec, c.id);
    expect(row).toMatchObject({ status: "RESOLVED", open: false, sla: "met", resolution: "Replaced the part under warranty" });

    const before = sandboxOutbox.length;
    const closed = await svc.changeCaseStatus(exec, c.id, { status: "CLOSED" });
    expect(closed.survey).toBe(true);
    const mail = sandboxOutbox[sandboxOutbox.length - 1]!;
    expect(sandboxOutbox.length).toBe(before + 1);
    expect(mail).toMatchObject({ channel: "EMAIL", to: email, from: { address: "care@hmnl.example.test" } });
    const stored = await unsafeDb.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(mail.text).toContain(`/api/public/csat/${stored.surveyToken}`);
    expect(mail.text).toContain(row.number);
    expect(stored.surveySentAt).not.toBeNull();
    // the survey message is logged on the case (brand-scoped)
    expect((await recordActivities(exec, "Case", c.id)).history.some((a) => a.type === "EMAIL_LOG")).toBe(true);

    // the customer answers once
    expect(await recordSurvey(stored.surveyToken!, 4, "Quick and friendly")).toMatchObject({ already: false, number: row.number });
    expect(await recordSurvey(stored.surveyToken!, 1, "changed my mind")).toMatchObject({ already: true });
    expect(await getCase(exec, c.id)).toMatchObject({ satisfactionScore: 4, satisfactionNote: "Quick and friendly" });
    expect(await recordSurvey("no-such-token", 5, null)).toBeNull();
    await expect(unsafeDb.case.update({ where: { id: c.id }, data: { satisfactionScore: 9 } })).rejects.toThrow();

    // reopening a closed case is for managers
    await expect(svc.changeCaseStatus(exec, c.id, { status: "IN_PROGRESS" })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.changeCaseStatus(bm, c.id, { status: "IN_PROGRESS" });
    expect(await getCase(exec, c.id)).toMatchObject({ status: "IN_PROGRESS", open: true, resolvedAt: null, closedAt: null });
  });

  it("queues: my cases, unassigned – my brand, take and reassign", async () => {
    const c = await newCase(exec, "HMNL");
    await unsafeDb.case.update({ where: { id: c.id }, data: { unassigned: true, ownerId: bm.userId } });
    const s = await newCase(snmnl, "SNMNL");
    await unsafeDb.case.update({ where: { id: s.id }, data: { unassigned: true } });
    const unassigned = (await listCases(exec2, { queue: "unassigned" }, {}, { take: 500 })).rows;
    expect(unassigned.map((r) => r.id)).toContain(c.id);
    expect(unassigned.map((r) => r.id)).not.toContain(s.id); // only my brand
    expect((await queueCounts(exec2)).unassigned).toBe(unassigned.length);
    await svc.assignCase(exec2, c.id); // take it
    expect(await getCase(exec2, c.id)).toMatchObject({ ownerId: exec2.userId, unassigned: false });
    expect((await listCases(exec2, { queue: "my" }, {}, { take: 500 })).rows.map((r) => r.id)).toContain(c.id);
    // a colleague cannot reassign someone else's case; the owner and managers can – only within the brand-region
    await expect(svc.assignCase(exec, c.id, exec.userId)).resolves.toMatchObject({ ownerId: exec.userId }); // taking for oneself is allowed
    await expect(svc.assignCase(exec2, c.id, bm.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await svc.assignCase(bm, c.id, exec2.userId);
    await expect(svc.assignCase(bm, c.id, snmnl.userId)).rejects.toBeInstanceOf(ForbiddenError); // not in HMNL
  });

  it("public case form and inbound messages create cases in the right brand, assigned round-robin", async () => {
    const mobile = phone();
    const lead = await createLead(exec, { firstName: "Known", lastName: `Customer ${rnd()}`, mobile, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const conv = await convertLead(exec, lead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "Known deal" } } as never);
    const a = await svc.intakeCase("hmnl", { name: "Known Customer", phone: mobile, subject: "Warranty question", message: "The warning light is on", type: "WARRANTY" });
    const b = await svc.intakeCase("HMNL", { name: "Stranger", email: `stranger.${rnd()}@example.test`, subject: "Brochure", message: "Please send a brochure" }, "EMAIL");
    expect(a.number).toMatch(/^HMNL-CS-/);
    const [ca, cb] = await Promise.all([a, b].map((x) => unsafeDb.case.findUniqueOrThrow({ where: { number: x.number! } })));
    expect(ca).toMatchObject({ brandId: I.brand("HMNL"), regionId: I.region("Lagos"), contactId: conv.contactId, accountId: conv.accountId, channel: "WEB", type: "WARRANTY" });
    expect(cb).toMatchObject({ channel: "EMAIL", contactId: null });
    const members = (await unsafeDb.territoryMember.findMany({ where: { isManager: false, territory: { brandId: I.brand("HMNL"), regionId: I.region("Lagos") } } })).map((m) => m.userId);
    expect(members).toContain(ca!.ownerId);
    expect(members).toContain(cb!.ownerId);
    expect(ca!.ownerId).not.toBe(cb!.ownerId); // round-robin
    await expect(svc.intakeCase("NOPE", { name: "x", subject: "x", message: "x" })).rejects.toBeInstanceOf(BadRequestError);
    expect((await svc.intakeCase("HMNL", { name: "bot", subject: "x", message: "x", website: "http://spam" })).status).toBe("ignored");

    // an inbound WhatsApp message on a deal becomes a case of that brand
    await receiveInbound({ channel: "WHATSAPP", receiver: "+2348100000011", from: mobile, text: "My car still has no plates", providerMessageId: `wamid.${rnd()}` });
    const inbound = (await recordActivities(exec, "Deal", conv.dealId)).history.find((x) => x.type === "WHATSAPP_LOG")!;
    const fromMessage = await svc.createCaseFromActivity(exec, inbound.id, { type: "DOCUMENTATION" });
    expect(await getCase(exec, fromMessage.id)).toMatchObject({ channel: "WHATSAPP", dealId: conv.dealId, contactId: conv.contactId, description: "My car still has no plates", brandId: I.brand("HMNL") });
    await expect(svc.createCaseFromActivity(snmnl, inbound.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("solutions knowledge base", () => {
  it("brand articles are for that brand's users; group articles for everyone; drafts for their managers", async () => {
    const brandArticle = await admin.saveSolution(bm, null, { brandId: I.brand("HMNL"), title: `HMNL warranty process ${rnd()}`, body: "Steps…", tags: "Warranty, Process", published: true });
    const draft = await admin.saveSolution(bm, null, { brandId: I.brand("HMNL"), title: "HMNL draft", body: "wip", tags: [], published: false });
    const group = await admin.saveSolution(hos, null, { brandId: null, title: `Number plate registration ${rnd()}`, body: "All brands…", tags: ["documentation"], published: true });
    const ids = async (ctx: AccessContext) => (await admin.listSolutions(ctx)).map((s) => s.id);
    expect(await ids(exec)).toEqual(expect.arrayContaining([brandArticle.id, group.id]));
    expect(await ids(exec)).not.toContain(draft.id);
    expect(await ids(bm)).toContain(draft.id);
    expect(await ids(snmnl)).toContain(group.id);
    expect(await ids(snmnl)).not.toContain(brandArticle.id);
    await expect(admin.getSolution(snmnl, brandArticle.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(admin.getSolution(exec, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await rawAsUser(snmnl, `SELECT id FROM "Solution" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    // managing
    await expect(admin.saveSolution(exec, null, { brandId: I.brand("HMNL"), title: "x", body: "x", tags: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin.saveSolution(bm, null, { brandId: null, title: "x", body: "x", tags: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin.saveSolution(bmSnmnl, brandArticle.id, { title: "hijack", body: "x", tags: [] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(admin.deleteSolution(exec, brandArticle.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rawAsUser(exec, `UPDATE "Solution" SET title = 'x' WHERE id = '${brandArticle.id}' RETURNING id`)).resolves.toEqual([]);
    // suggestions for a case: same brand or group, by type / words
    const suggestions = (await admin.suggestSolutions(exec, { brandId: I.brand("HMNL"), type: "WARRANTY", subject: "Engine warranty" })).map((s) => s.id);
    expect(suggestions).toContain(brandArticle.id);
    expect((await admin.suggestSolutions(snmnl, { brandId: I.brand("SNMNL"), type: "WARRANTY", subject: "Engine warranty" })).map((s) => s.id)).not.toContain(brandArticle.id);
    expect((await admin.listSolutions(exec, { tag: "documentation" })).map((s) => s.id)).toContain(group.id);
  });

  it("the business calendar is changed by administrators only", async () => {
    await expect(admin.saveBusinessHours(bm, { workDays: [1, 2, 3, 4, 5], opensAt: "09:00", closesAt: "16:00" })).rejects.toBeInstanceOf(NotFoundError);
    await admin.saveBusinessHours(adminCtx, { workDays: [1, 2, 3, 4, 5], opensAt: "09:00", closesAt: "16:00" });
    await admin.addHoliday(adminCtx, { date: "2031-03-03", name: "Test holiday" });
    await expect(admin.addHoliday(adminCtx, { date: "2031-03-03", name: "Again" })).rejects.toBeInstanceOf(BadRequestError);
    const cal = await loadCalendar(exec);
    expect(cal).toMatchObject({ workDays: [1, 2, 3, 4, 5], opensAt: "09:00", closesAt: "16:00" });
    expect(cal.holidays.has("2031-03-03")).toBe(true);
    expect((await admin.getCalendarSettings(exec)).holidays.some((h) => h.name === "Independence Day")).toBe(true);
    await admin.removeHoliday(adminCtx, "2031-03-03");
    await admin.saveBusinessHours(adminCtx, { workDays: [1, 2, 3, 4, 5, 6], opensAt: "08:00", closesAt: "17:00" });
    await expect(rawAsUser(exec, `INSERT INTO "Holiday" (date, name) VALUES ('2031-04-04', 'x')`)).rejects.toThrow(/row-level security/);
  });
});

describe("reports", () => {
  it("the report builder has a Cases module, scoped like everything else", async () => {
    const byType = await runReport(exec, definitionSchema.parse({ module: "cases", groupBy: [{ field: "brand" }, { field: "type" }], summaries: [{ fn: "count" }, { fn: "avg", field: "satisfactionScore" }], filters: [] }));
    expect([...new Set(byType.rows.map((r) => r[0]))]).toEqual(["HMNL"]);
    const all = await runReport(hos, definitionSchema.parse({ module: "cases", groupBy: [{ field: "brand" }], summaries: [{ fn: "count" }], filters: [] }));
    expect(all.rows.map((r) => r[0])).toEqual(expect.arrayContaining(["HMNL", "SNMNL"]));
    for (const key of ["cases-by-brand-type", "case-sla-compliance", "case-csat"]) {
      const { result } = await runSavedReport(exec, key);
      expect(result.rows.every((r) => r[0] === "HMNL"), key).toBe(true);
    }
    const sla = (await runSavedReport(hos, "case-sla-compliance")).result;
    expect(sla.rows.some((r) => String(r[1]).startsWith("Resolved") || String(r[1]).startsWith("Open"))).toBe(true);
  });
});
