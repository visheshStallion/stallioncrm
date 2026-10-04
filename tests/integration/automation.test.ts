import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { autoApproveDue, updateApprovalProcess } from "@/server/db/approval-engine";
import { listJobs } from "@/server/db/jobs";
import { deleteRule, saveRule } from "@/server/db/workflow-store";
import { BadRequestError } from "@/server/errors";
import { createActivity } from "@/server/modules/activities/service";
import * as approvals from "@/server/modules/approvals/service";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal, updateDeal } from "@/server/modules/deals/service";
import { getDocument } from "@/server/modules/documents/queries";
import * as docs from "@/server/modules/documents/service";
import { createLead } from "@/server/modules/leads/service";
import { addNote } from "@/server/modules/notes/service";
import { myNotifications } from "@/server/modules/notifications/service";
import { assertPublicUrl, runDueJobs, runScheduler } from "@/server/modules/workflow/engine";
import { ruleSchema } from "@/server/modules/workflow/schema";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let multi: AccessContext; // HMNL + SNMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let bmSnmnl: AccessContext;
let snmnl: AccessContext; // SNMNL Lagos exec
let hos: AccessContext;
let rsm: AccessContext;
let admin: AccessContext;
let model: { id: string };

beforeAll(async () => {
  I = await ids();
  [exec, multi, bm, bmSnmnl, snmnl, hos, rsm, admin] = (await Promise.all(["exec.hmnl.1", "exec.multi.1", "bm.hmnl", "bm.snmnl", "exec.snmnl.1", "hos", "rsm", "admin"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, orderBy: { code: "asc" } });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const newDeal = (ctx: AccessContext, brand = "HMNL", over: Record<string, unknown> = {}) =>
  createDeal(ctx, { name: `Auto deal ${rnd()}`, brandId: I.brand(brand), regionId: I.region("Lagos"), ...over } as never);
const lineOf = (discountPct: number) => ({ productId: model.id, description: "HMNL vehicle", qty: 1, unitPrice: 40_000_000, discountPct, taxRate: 7.5 });
async function quoteWithDiscount(pct: number) {
  const deal = await newDeal(exec, "HMNL", { modelId: model.id });
  const q = await docs.createQuoteFromDeal(exec, deal.id);
  await docs.saveDocument(exec, "quote", q.id, { lines: [lineOf(pct)] as never });
  return { dealId: deal.id, quoteId: q.id, res: await docs.submitQuote(exec, q.id) };
}
/** Runs the queue until it is empty. */
async function drain() {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const { done, failed } = await runDueJobs(100);
    total += done;
    if (done + failed === 0) break;
  }
  return total;
}

describe("discount approval", () => {
  it("5 % on an HMNL quote → one request to the HMNL manager; the SNMNL manager's inbox stays empty", async () => {
    const { quoteId, res } = await quoteWithDiscount(5);
    expect(res.status).toBe("PENDING_APPROVAL");
    const requests = await unsafeDb.approvalRequest.findMany({ where: { entity: "Quote", entityId: quoteId }, include: { tasks: true } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tasks.map((t) => t.approverId)).toEqual([bm.userId]);
    expect(requests[0]!.level).toBe(1);

    const inbox = await approvals.myApprovalTasks(bm);
    expect(inbox.some((t) => t.requestId === requests[0]!.id && t.kind === "DISCOUNT")).toBe(true);
    expect((await myNotifications(bm, 50)).rows.some((n) => n.kind === "APPROVAL")).toBe(true);
    // another brand's manager: nothing in the inbox, nothing through RLS, and the request itself is a 404
    expect(await approvals.myApprovalTasks(bmSnmnl)).toEqual([]);
    expect(await approvals.pendingApprovalCount(bmSnmnl)).toBe(0);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "ApprovalTask" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "ApprovalRequest" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    await expect(approvals.decide(bmSnmnl, requests[0]!.id, true)).rejects.toBeInstanceOf(NotFoundError);
    // a colleague who can see the quote but is not the approver: 403
    await expect(approvals.decide(await ctxFor("exec.hmnl.2"), requests[0]!.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    // user sessions cannot forge tasks or decisions
    await expect(rawAsUser(exec, `UPDATE "ApprovalTask" SET status = 'APPROVED'`)).rejects.toThrow(/permission denied/);

    const out = await approvals.decide(bm, requests[0]!.id, true, "ok");
    expect(out.status).toBe("APPROVED");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("APPROVED");
    expect((await myNotifications(exec, 50)).rows.some((n) => n.kind === "APPROVAL" && n.title.includes("approved"))).toBe(true);
    await expect(approvals.decide(bm, requests[0]!.id, true)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("8 % → two steps: Brand Manager, then Head of Sales", async () => {
    const { quoteId } = await quoteWithDiscount(8);
    const req = await unsafeDb.approvalRequest.findFirstOrThrow({ where: { entity: "Quote", entityId: quoteId }, include: { tasks: true } });
    expect(req.level).toBe(2);
    expect(req.tasks.map((t) => t.approverId)).toEqual([bm.userId]); // step 2 is not open yet
    expect(await approvals.myApprovalTasks(hos)).toEqual([]);
    expect((await approvals.decide(bm, req.id, true)).status).toBe("PENDING");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("PENDING_APPROVAL");
    const hosInbox = await approvals.myApprovalTasks(hos);
    expect(hosInbox.map((t) => t.requestId)).toEqual([req.id]);
    // the Brand Manager has decided and cannot decide the next step
    await expect(approvals.decide(bm, req.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await approvals.decide(hos, req.id, true)).status).toBe("APPROVED");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("APPROVED");
    const done = await unsafeDb.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect((done.comments as Array<{ action: string }>).map((c) => c.action)).toEqual(["SUBMITTED", "APPROVED", "APPROVED"]);
  });

  it("the requester can recall; an inactive process approves directly; auto-approve after the configured time", async () => {
    const a = await quoteWithDiscount(5);
    const req = await unsafeDb.approvalRequest.findFirstOrThrow({ where: { entity: "Quote", entityId: a.quoteId } });
    await expect(approvals.recall(await ctxFor("exec.hmnl.2"), req.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await approvals.recall(exec, req.id)).status).toBe("CANCELLED");
    expect((await getDocument(exec, "quote", a.quoteId)).status).toBe("DRAFT");
    expect(await approvals.myApprovalTasks(bm)).not.toContainEqual(expect.objectContaining({ requestId: req.id }));

    // auto-approve: step 1 after 1 hour
    await expect(updateApprovalProcess(exec, "ap_discount", { active: false })).rejects.toBeInstanceOf(NotFoundError); // admins only
    await updateApprovalProcess(admin, "ap_discount", { autoApproveAfterHours: { aps_discount_1: 1 } });
    const b = await quoteWithDiscount(5);
    expect(await autoApproveDue(new Date())).toEqual([]);
    const auto = await autoApproveDue(new Date(Date.now() + 2 * 3_600_000));
    expect(auto.map((o) => o.entityId)).toContain(b.quoteId);
    expect((await getDocument(exec, "quote", b.quoteId)).status).toBe("APPROVED");
    await updateApprovalProcess(admin, "ap_discount", { autoApproveAfterHours: { aps_discount_1: null } });

    await updateApprovalProcess(admin, "ap_discount", { active: false });
    expect((await quoteWithDiscount(5)).res.status).toBe("APPROVED");
    await updateApprovalProcess(admin, "ap_discount", { active: true });
  });
});

describe("brand change", () => {
  it("needs both Brand Managers, locks the record, then moves the deal and its children atomically with an audit entry", async () => {
    const deal = await newDeal(multi, "HMNL", { modelId: model.id });
    const quote = await docs.createQuoteFromDeal(multi, deal.id);
    const activity = await createActivity(multi, { type: "TASK", parentType: "Deal", parentId: deal.id, subject: "Call customer", dueAt: new Date(Date.now() + 3_600_000).toISOString() } as never);
    await addNote(multi, "Deal", deal.id, "Customer prefers the other brand");

    // pre-checks: same brand, owner not working in the target brand
    await expect(approvals.requestBrandChange(multi, "Deal", deal.id, { newBrandId: I.brand("HMNL") })).rejects.toBeInstanceOf(BadRequestError);
    const hmnlOnly = await newDeal(exec);
    await expect(approvals.requestBrandChange(exec, "Deal", hmnlOnly.id, { newBrandId: I.brand("SNMNL") })).rejects.toThrow(/choose a new owner/);
    // a user who cannot see the deal cannot request anything
    await expect(approvals.requestBrandChange(snmnl, "Deal", deal.id, { newBrandId: I.brand("SNMNL") })).rejects.toBeInstanceOf(NotFoundError);

    const out = await approvals.requestBrandChange(multi, "Deal", deal.id, { newBrandId: I.brand("SNMNL"), reason: "Customer switched" });
    expect(out.status).toBe("PENDING");
    expect(new Set(out.pendingApproverIds)).toEqual(new Set([bm.userId, bmSnmnl.userId]));
    await expect(approvals.requestBrandChange(multi, "Deal", deal.id, { newBrandId: I.brand("SNMNL") })).rejects.toThrow(/already pending/);

    // locked while pending – for everyone but administrators
    await expect(updateDeal(multi, deal.id, { name: "changed" } as never)).rejects.toThrow(/RECORD_LOCKED/);
    await expect(rawAsUser(bm, `UPDATE "Deal" SET name = 'x' WHERE id = '${deal.id}'`)).rejects.toThrow(/RECORD_LOCKED/);
    await updateDeal(admin, deal.id, { colour: "Blue" } as never);
    const banner = await approvals.pendingApprovalsFor(multi, "Deal", deal.id);
    expect(banner).toHaveLength(1);
    expect(banner[0]).toMatchObject({ kind: "BRAND_CHANGE", canDecide: false, canRecall: true });
    expect(banner[0]!.waitingFor).toHaveLength(2);

    // the NEW brand's manager sees the task (without a link to the record, which they cannot open yet)
    const snmnlInbox = await approvals.myApprovalTasks(bmSnmnl);
    expect(snmnlInbox).toHaveLength(1);
    expect(snmnlInbox[0]).toMatchObject({ requestId: out.requestId, href: null, kind: "BRAND_CHANGE" });
    await expect(getDeal(bmSnmnl, deal.id)).rejects.toBeInstanceOf(NotFoundError);

    expect((await approvals.decide(bm, out.requestId!, true)).status).toBe("PENDING");
    expect((await getDeal(multi, deal.id)).brandId).toBe(I.brand("HMNL")); // nothing moved yet

    // atomic: when applying fails, nothing changes – not even the approver's decision
    await unsafeDb.brand.update({ where: { id: I.brand("SNMNL") }, data: { status: "INACTIVE" } });
    await expect(approvals.decide(bmSnmnl, out.requestId!, true)).rejects.toThrow(/inactive/);
    await unsafeDb.brand.update({ where: { id: I.brand("SNMNL") }, data: { status: "ACTIVE" } });
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).brandId).toBe(I.brand("HMNL"));
    expect(await unsafeDb.approvalTask.count({ where: { requestId: out.requestId!, approverId: bmSnmnl.userId, status: "PENDING" } })).toBe(1);

    const auditFrom = new Date();
    expect((await approvals.decide(bmSnmnl, out.requestId!, true, "Welcome")).status).toBe("APPROVED");

    const moved = await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id }, include: { pipeline: true, stage: true, territory: true } });
    expect(moved.brandId).toBe(I.brand("SNMNL"));
    expect(moved.pipeline!.brandId).toBe(I.brand("SNMNL"));
    expect(moved.stage!.key).toBe("ENQUIRY");
    expect(moved.territory).toMatchObject({ brandId: I.brand("SNMNL"), regionId: I.region("Lagos") });
    expect(moved.modelId).toBeNull(); // the HMNL model cannot follow
    expect(moved.ownerId).toBe(multi.userId);
    // children moved with it
    const q = await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } });
    expect(q).toMatchObject({ brandId: I.brand("SNMNL"), status: "DRAFT", territoryId: moved.territoryId });
    expect(q.lines.every((l) => l.productId === null)).toBe(true);
    expect((await unsafeDb.activity.findUniqueOrThrow({ where: { id: activity.id } })).brandId).toBe(I.brand("SNMNL"));
    expect((await unsafeDb.note.findFirstOrThrow({ where: { entity: "Deal", entityId: deal.id } })).brandId).toBe(I.brand("SNMNL"));
    // visibility follows the brand
    await expect(getDeal(exec, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDeal(snmnl, deal.id)).brandId).toBe(I.brand("SNMNL"));
    // audit: before / after
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "Deal", entityId: deal.id, at: { gte: auditFrom }, action: "UPDATE" }, orderBy: { at: "desc" } });
    expect(entry.before).toMatchObject({ brandId: I.brand("HMNL") });
    expect(entry.after).toMatchObject({ brandId: I.brand("SNMNL"), brandChange: { approvalRequestId: out.requestId, approvedBy: bmSnmnl.user.name } });
    expect(entry.userId).toBe(bmSnmnl.userId);
    // unlocked again
    await updateDeal(multi, deal.id, { colour: "Red" } as never);
  });

  it("a rejection changes nothing and unlocks the record; a deal with a sales order cannot change brand", async () => {
    const deal = await newDeal(multi);
    const out = await approvals.requestBrandChange(multi, "Deal", deal.id, { newBrandId: I.brand("SNMNL") });
    expect((await approvals.decide(bmSnmnl, out.requestId!, false, "Not for us")).status).toBe("REJECTED");
    expect((await getDeal(multi, deal.id)).brandId).toBe(I.brand("HMNL"));
    expect(await approvals.myApprovalTasks(bm)).not.toContainEqual(expect.objectContaining({ requestId: out.requestId }));
    await updateDeal(multi, deal.id, { colour: "Green" } as never);

    const lead = await createLead(multi, { firstName: "Brand", lastName: `Lead ${rnd()}`, mobile: `+23480${Math.floor(10000000 + Math.random() * 89999999)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const l = await approvals.requestBrandChange(multi, "Lead", lead.id, { newBrandId: I.brand("SNMNL") });
    await approvals.decide(bm, l.requestId!, true);
    await approvals.decide(bmSnmnl, l.requestId!, true);
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).brandId).toBe(I.brand("SNMNL"));
  });
});

describe("owner transfer across regions", () => {
  it("is approved by the RSM or the Brand Manager and moves region, owner and territory", async () => {
    const deal = await newDeal(exec);
    const activity = await createActivity(exec, { type: "TASK", parentType: "Deal", parentId: deal.id, subject: "Hand over", dueAt: new Date(Date.now() + 3_600_000).toISOString() } as never);
    const abuja = await userId("exec.abuja");
    await expect(approvals.requestOwnerTransfer(exec, "Deal", deal.id, { newRegionId: I.region("Lagos"), newOwnerId: abuja })).rejects.toBeInstanceOf(BadRequestError);
    // the new owner must work in the target region of the brand
    await expect(approvals.requestOwnerTransfer(exec, "Deal", deal.id, { newRegionId: I.region("Abuja"), newOwnerId: await userId("exec.hmnl.2") })).rejects.toThrow(/does not work/);
    const out = await approvals.requestOwnerTransfer(exec, "Deal", deal.id, { newRegionId: I.region("Abuja"), newOwnerId: abuja, reason: "Customer relocated" });
    expect(new Set(out.pendingApproverIds)).toEqual(new Set([rsm.userId, bm.userId]));
    // any ONE of them decides
    expect((await approvals.decide(rsm, out.requestId!, true)).status).toBe("APPROVED");
    expect(await approvals.myApprovalTasks(bm)).not.toContainEqual(expect.objectContaining({ requestId: out.requestId }));
    const moved = await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id }, include: { territory: true } });
    expect(moved).toMatchObject({ brandId: I.brand("HMNL"), regionId: I.region("Abuja"), ownerId: abuja });
    expect(moved.territory).toMatchObject({ brandId: I.brand("HMNL"), regionId: I.region("Abuja") });
    expect((await unsafeDb.activity.findUniqueOrThrow({ where: { id: activity.id } })).regionId).toBe(I.region("Abuja"));
    // the Lagos exec no longer sees it, the Abuja exec does
    await expect(getDeal(exec, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDeal(await ctxFor("exec.abuja"), deal.id)).ownerId).toBe(abuja);
  });
});

describe("workflow rules", () => {
  it("stale deal: task for the owner and a notification to the Brand Manager – exactly once (idempotent)", async () => {
    const deal = await newDeal(exec);
    await unsafeDb.$executeRaw`UPDATE "Deal" SET "updatedAt" = ${new Date(Date.now() - 8 * 86_400_000)} WHERE id = ${deal.id}`;
    const subject = "Follow up: deal not updated for 7 days";
    const tasks = () => unsafeDb.activity.count({ where: { parentType: "Deal", parentId: deal.id, subject } });

    expect(await runScheduler()).toBeGreaterThanOrEqual(1);
    await drain();
    expect(await tasks()).toBe(1);
    const task = await unsafeDb.activity.findFirstOrThrow({ where: { parentType: "Deal", parentId: deal.id, subject } });
    expect(task).toMatchObject({ ownerId: exec.userId, brandId: I.brand("HMNL"), priority: "HIGH", createdById: null });
    const notes = (await myNotifications(bm, 200)).rows.filter((n) => n.href === `/deals/${deal.id}` && n.title.startsWith("Deal not updated for 7 days"));
    expect(notes).toHaveLength(1);

    // a second and third run change nothing
    expect(await runScheduler()).toBe(0);
    await drain();
    await runScheduler();
    await drain();
    expect(await tasks()).toBe(1);
    expect((await myNotifications(bm, 200)).rows.filter((n) => n.href === `/deals/${deal.id}` && n.title.startsWith("Deal not updated")).length).toBe(1);
    // a fresh deal is not stale
    const fresh = await newDeal(exec);
    await runScheduler();
    await drain();
    expect(await unsafeDb.activity.count({ where: { parentId: fresh.id, subject } })).toBe(0);
  });

  it("hot lead not contacted in 2 hours is escalated to the Brand Manager once", async () => {
    const lead = await createLead(exec, { firstName: "Hot", lastName: `Lead ${rnd()}`, mobile: `+23480${Math.floor(10000000 + Math.random() * 89999999)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    await unsafeDb.lead.update({ where: { id: lead.id }, data: { rating: "HOT", status: "NEW", createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    await runScheduler();
    await drain();
    await runScheduler();
    await drain();
    const tasks = await unsafeDb.activity.findMany({ where: { parentType: "Lead", parentId: lead.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ ownerId: bm.userId, priority: "HIGH" });
    expect((await myNotifications(bm, 200)).rows.filter((n) => n.href === `/leads/${lead.id}`).length).toBeGreaterThanOrEqual(1);
    expect((await myNotifications(bmSnmnl, 200)).rows.filter((n) => n.href === `/leads/${lead.id}`)).toEqual([]);
  });

  it("deal Closed Won → thank-you task and a follow-up call three days later", async () => {
    const deal = await newDeal(exec);
    const won = await unsafeDb.pipelineStage.findFirstOrThrow({ where: { pipeline: { brandId: I.brand("HMNL"), isDefault: true }, type: "WON" } });
    await scopedDb(hos).deal.update({ where: { id: deal.id }, data: { stageId: won.id }, select: { id: true } });
    await drain();
    const created = await unsafeDb.activity.findMany({ where: { parentType: "Deal", parentId: deal.id }, orderBy: { dueAt: "asc" } });
    expect(created.map((a) => [a.type, a.subject])).toEqual([
      ["TASK", "Send thank-you message"],
      ["CALL", "After-delivery follow-up call"],
    ]);
    expect(Math.round((created[1]!.dueAt!.getTime() - Date.now()) / 3_600_000)).toBe(72);
    // editing another field does not fire the stage rule again
    await scopedDb(hos).deal.update({ where: { id: deal.id }, data: { colour: "White" }, select: { id: true } });
    await drain();
    expect(await unsafeDb.activity.count({ where: { parentType: "Deal", parentId: deal.id } })).toBe(2);
  });

  it("a rule scoped to a brand never touches other brands; notifications only reach users who can see the record", async () => {
    const input = ruleSchema.parse({
      name: `HMNL new lead ${rnd()}`,
      module: "leads",
      trigger: "ON_CREATE",
      brandId: I.brand("HMNL"),
      actions: [
        { type: "SEND_NOTIFICATION", to: "ROLE", roleName: "Brand Manager", title: "New lead {{name}}" },
        { type: "FIELD_UPDATE", field: "rating", value: "WARM" },
      ],
    });
    await expect(saveRule(exec, null, input as never)).rejects.toBeInstanceOf(NotFoundError); // administrators only
    const rule = await saveRule(admin, null, input as never);
    const mk = (ctx: AccessContext, brand: string) =>
      createLead(ctx, { firstName: "Rule", lastName: `Lead ${rnd()}`, mobile: `+23480${Math.floor(10000000 + Math.random() * 89999999)}`, brandId: I.brand(brand), regionId: I.region("Lagos"), source: "WALK_IN" } as never);
    const [h, s] = [await mk(exec, "HMNL"), await mk(snmnl, "SNMNL")];
    await drain();
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: h.id } })).rating).toBe("WARM");
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: s.id } })).rating).toBeNull();
    expect(await unsafeDb.job.count({ where: { ruleId: rule.id } })).toBe(1);
    // role "Brand Manager" = five people, but only the one who can see the HMNL lead is notified
    const got = async (c: AccessContext) => (await myNotifications(c, 200)).rows.filter((n) => n.href === `/leads/${h.id}`).length;
    expect(await got(bm)).toBe(1);
    expect(await got(bmSnmnl)).toBe(0);
    // the rule's own update did not trigger rules again (no cascade)
    expect((await listJobs({ ruleId: rule.id })).rows.map((j) => j.status)).toEqual(["DONE"]);
    await deleteRule(admin, rule.id);
  });

  it("failed jobs are retried with back-off and end up in the run log; webhooks cannot target private addresses", async () => {
    await expect(assertPublicUrl("https://127.0.0.1/hook")).rejects.toThrow(/public/);
    await expect(assertPublicUrl("https://10.1.2.3/hook")).rejects.toThrow(/public/);
    await expect(assertPublicUrl("https://[::1]/hook")).rejects.toThrow(/public/);
    await expect(assertPublicUrl("http://example.com/hook")).rejects.toThrow(/https/);
    expect(ruleSchema.safeParse({ name: "x", module: "leads", trigger: "ON_CREATE", actions: [{ type: "WEBHOOK", url: "http://example.com" }] }).success).toBe(false);

    const rule = await saveRule(admin, null, ruleSchema.parse({ name: `Hook ${rnd()}`, module: "deals", trigger: "ON_CREATE", brandId: I.brand("HMNL"), actions: [{ type: "CREATE_TASK", subject: "First action" }, { type: "WEBHOOK", url: "https://127.0.0.1/hook" }] }) as never);
    const deal = await newDeal(exec);
    const first = await runDueJobs(100);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    const job = (await listJobs({ ruleId: rule.id })).rows[0]!;
    expect(job).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(job.lastError).toMatch(/public address/);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now()); // back-off
    // the retry continues after the completed first action: still exactly one task
    await unsafeDb.job.update({ where: { id: job.id }, data: { runAt: new Date(), attempts: 4 } });
    await runDueJobs(100);
    expect((await listJobs({ ruleId: rule.id })).rows[0]).toMatchObject({ status: "DEAD", attempts: 5 });
    expect(await unsafeDb.activity.count({ where: { parentId: deal.id, subject: "First action" } })).toBe(1);
    await deleteRule(admin, rule.id);
  });
});
