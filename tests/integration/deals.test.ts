import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db/scoped";
import { dealStageHistory, getDeal, listDeals, listPipelines } from "@/server/modules/deals/queries";
import * as svc from "@/server/modules/deals/service";
import * as notes from "@/server/modules/notes/service";
import { localDriver, setStorageDriver } from "@/server/storage";
import os from "node:os";
import path from "node:path";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos sales exec
let bm: AccessContext; // HMNL brand manager
let abuja: AccessContext;
let stageIds: Map<string, string>; // HMNL default pipeline: key → stage id

const cells = (rows: Array<{ brandId: string; regionId: string }>) => [...new Set(rows.map((d) => `${I.brandCode(d.brandId)}|${I.regionName(d.regionId)}`))].sort();

beforeAll(async () => {
  I = await ids();
  [exec, bm, abuja] = await Promise.all([ctxFor("exec.hmnl.1"), ctxFor("bm.hmnl"), ctxFor("exec.abuja")]);
  const pipeline = await unsafeDb.pipeline.findFirstOrThrow({ where: { brandId: I.brand("HMNL"), isDefault: true }, include: { stages: true } });
  stageIds = new Map(pipeline.stages.map((s) => [s.key, s.id]));
  setStorageDriver(localDriver(path.join(os.tmpdir(), `stallioncrm-uploads-${process.pid}`)));
});

const newDeal = (ctx: AccessContext, over: Record<string, unknown> = {}) =>
  svc.createDeal(ctx, { name: `Test deal ${Math.random().toString(36).slice(2, 8)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ...over } as never);

describe("pipelines", () => {
  it("every brand has a default pipeline with the 8 default stages", async () => {
    const pipelines = await unsafeDb.pipeline.findMany({ where: { isDefault: true }, include: { stages: true } });
    expect(pipelines).toHaveLength(await unsafeDb.brand.count());
    for (const p of pipelines) {
      expect(p.stages.sort((a, b) => a.order - b.order).map((s) => `${s.key}:${s.probability}`)).toEqual([
        "ENQUIRY:10",
        "TEST_DRIVE:25",
        "QUOTATION:40",
        "BOOKING:70",
        "FINANCE_PAYMENT:85",
        "DELIVERY:95",
        "CLOSED_WON:100",
        "CLOSED_LOST:0",
      ]);
    }
  });

  it("the pipeline picker lists only the user's brands", async () => {
    expect((await listPipelines(exec)).map((p) => I.brandCode(p.brandId))).toEqual(["HMNL"]);
    expect((await listPipelines(await ctxFor("exec.multi.1"))).map((p) => I.brandCode(p.brandId))).toEqual(["HMNL", "SNMNL"]);
    expect((await listPipelines(await ctxFor("md"))).length).toBe(10);
  });

  it("a deal cannot use another brand's pipeline (DB trigger)", async () => {
    const other = await unsafeDb.pipeline.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(newDeal(exec, { pipelineId: other.id })).rejects.toThrow(/pipeline/i);
    const { id } = await newDeal(exec);
    const snmnlStage = await unsafeDb.pipelineStage.findFirstOrThrow({ where: { pipelineId: other.id } });
    await expect(unsafeDb.deal.update({ where: { id }, data: { stageId: snmnlStage.id } })).rejects.toThrow(/stage does not belong/i);
  });

  it("new deals start in the first stage of the brand's default pipeline, with a history entry", async () => {
    const { id } = await newDeal(exec);
    const deal = await getDeal(exec, id);
    expect(deal.stage).toBe("ENQUIRY");
    expect(deal.stageId).toBe(stageIds.get("ENQUIRY"));
    const history = await dealStageHistory(exec, id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: null, to: "Enquiry" });
  });
});

describe("isolation (prompt 04)", () => {
  it("kanban data for an HMNL exec contains no other-brand deals", async () => {
    const { rows } = await listDeals(exec, {}, { take: 1000 });
    expect(cells(rows)).toEqual(["HMNL|Lagos"]);
  });

  it("Abuja exec sees Abuja deals of all brands and no Lagos deals", async () => {
    const { rows } = await listDeals(abuja, {}, { take: 1000 });
    expect(cells(rows)).toEqual(["HMNL|Abuja", "SMGL|Abuja", "SNMNL|Abuja", "THPL|Abuja", "ZANL|Abuja"]);
  });

  it("HMNL Brand Manager sees all four regions of HMNL and nothing else", async () => {
    const { rows } = await listDeals(bm, {}, { take: 1000 });
    expect(cells(rows)).toEqual(["HMNL|Abuja", "HMNL|Ibadan", "HMNL|Lagos", "HMNL|Port Harcourt"]);
  });

  it("a hidden deal is 404 for read, update, stage move, owner change, notes and history", async () => {
    const hidden = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(getDeal(exec, hidden.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateDeal(exec, hidden.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.moveDealStage(exec, hidden.id, stageIds.get("TEST_DRIVE")!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.changeDealOwner(exec, hidden.id, exec.userId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(notes.addNote(exec, "Deal", hidden.id, "hello")).rejects.toBeInstanceOf(NotFoundError);
    await expect(dealStageHistory(exec, hidden.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stage history of hidden deals is invisible even to raw SQL (RLS)", async () => {
    const mine = await rawAsUser<{ dealId: string }>(exec, `SELECT "dealId" FROM "DealStageHistory"`);
    expect(mine.length).toBeGreaterThan(0);
    const visible = new Set((await listDeals(exec, {}, { take: 1000 })).rows.map((r) => r.id));
    expect(mine.every((h) => visible.has(h.dealId))).toBe(true);
    await expect(rawAsUser(exec, `INSERT INTO "DealStageHistory" (id, "dealId", "toStageId") VALUES ('x', '${[...visible][0]}', 'y')`)).rejects.toThrow(/permission denied/);
  });
});

describe("Blueprint enforcement", () => {
  it("cannot move to Delivery without VIN; VIN is unique per brand", async () => {
    const { id } = await newDeal(bm, { regionId: I.region("Lagos") });
    // manager may jump stages, but requirements still apply
    await expect(svc.moveDealStage(bm, id, stageIds.get("DELIVERY")!)).rejects.toThrow(/VIN \/ chassis no\./);
    await svc.moveDealStage(bm, id, stageIds.get("DELIVERY")!, { vinChassisNo: "vin-unique-001", deliveryDate: "2026-11-01" } as never);
    const deal = await getDeal(bm, id);
    expect(deal.stage).toBe("DELIVERY");
    expect(deal.vinChassisNo).toBe("VIN-UNIQUE-001");

    const second = await newDeal(bm);
    await expect(svc.moveDealStage(bm, second.id, stageIds.get("DELIVERY")!, { vinChassisNo: "VIN-UNIQUE-001", deliveryDate: "2026-11-01" } as never)).rejects.toThrow(/already used/);
    // the same VIN in another brand is fine
    const snmnl = await ctxFor("bm.snmnl");
    const other = await svc.createDeal(snmnl, { name: "Other brand", brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } as never);
    await svc.updateDeal(snmnl, other.id, { vinChassisNo: "VIN-UNIQUE-001" });
  });

  it("a sales exec moves one step at a time and must supply the stage's fields", async () => {
    const { id } = await newDeal(exec);
    await expect(svc.moveDealStage(exec, id, stageIds.get("BOOKING")!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.moveDealStage(exec, id, stageIds.get("TEST_DRIVE")!)).rejects.toThrow(/Test drive date, Model/);
    const model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") } });
    const foreign = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(svc.moveDealStage(exec, id, stageIds.get("TEST_DRIVE")!, { testDriveDate: "2026-10-06", modelId: foreign.id } as never)).rejects.toThrow(/deal's brand/);
    await svc.moveDealStage(exec, id, stageIds.get("TEST_DRIVE")!, { testDriveDate: "2026-10-06", modelId: model.id } as never);
    await svc.moveDealStage(exec, id, stageIds.get("QUOTATION")!); // "quote" check is not enforced until quotes exist
    await expect(svc.moveDealStage(exec, id, stageIds.get("BOOKING")!, { depositAmount: 1_000_000 } as never)).rejects.toThrow(/Deposit receipt no\./);
    await svc.moveDealStage(exec, id, stageIds.get("BOOKING")!, { depositAmount: 1_000_000, depositReceiptNo: "RCP-1" } as never);
    await expect(svc.moveDealStage(exec, id, stageIds.get("CLOSED_LOST")!)).rejects.toThrow(/Loss reason/);
    await svc.moveDealStage(exec, id, stageIds.get("CLOSED_LOST")!, { lossReason: "Bought elsewhere" } as never);

    const history = await dealStageHistory(exec, id);
    expect(history.map((h) => h.to).reverse()).toEqual(["Enquiry", "Test Drive", "Quotation", "Booking", "Closed Lost"]);
    expect(history[0]!.user).toBe(exec.user.name);
    expect(history[0]!.durationHours).not.toBeNull();
  });

  it("management has no edit permission, so cannot move stages", async () => {
    const { id } = await newDeal(exec);
    await expect(svc.moveDealStage(await ctxFor("md"), id, stageIds.get("TEST_DRIVE")!)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("field rules", () => {
  it("brand cannot be changed by editing; region only by managers; owner must have access", async () => {
    const { id } = await newDeal(exec);
    await expect(svc.updateDeal(exec, id, { brandId: I.brand("SNMNL") } as never)).rejects.toThrow(/Brand Change approval/);
    await expect(svc.updateDeal(bm, id, { brandId: I.brand("SNMNL") } as never)).rejects.toThrow(/Brand Change approval/);
    await expect(svc.updateDeal(exec, id, { regionId: I.region("Abuja") } as never)).rejects.toThrow(/Only managers/);
    await svc.updateDeal(bm, id, { regionId: I.region("Abuja") } as never);
    const moved = await unsafeDb.deal.findUniqueOrThrow({ where: { id }, include: { territory: true } });
    expect(moved.territory?.name).toBe("HMNL – Abuja");

    await expect(svc.changeDealOwner(bm, id, await userId("exec.snmnl.1"))).rejects.toThrow(/no access/);
    await svc.changeDealOwner(bm, id, await userId("exec.abuja"));
  });

  it("model must belong to the deal's brand; stale flag follows the stage limit", async () => {
    const foreign = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("ZANL") } });
    await expect(newDeal(exec, { modelId: foreign.id })).rejects.toThrow(/deal's brand/);
    const { id } = await newDeal(exec);
    await unsafeDb.deal.update({ where: { id }, data: { stageEnteredAt: new Date(Date.now() - 30 * 86_400_000) } });
    const deal = await getDeal(exec, id);
    expect(deal.stale).toBe(true);
    expect(deal.daysInStage).toBe(30);
  });
});

describe("notes & attachments are brand-scoped", () => {
  it("notes and files on an HMNL deal are invisible to other brands and regions", async () => {
    const { id } = await newDeal(exec);
    await notes.addNote(exec, "Deal", id, "Customer prefers white");
    const att = await notes.addAttachment(exec, "Deal", id, { name: "../../quote v1.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-fake") });
    expect((await notes.listNotes(bm, "Deal", id)).map((n) => n.body)).toEqual(["Customer prefers white"]);
    const file = await notes.readAttachment(bm, att.id);
    expect(new TextDecoder().decode(file.bytes)).toBe("%PDF-fake");
    expect(file.fileName).not.toContain("/");
    const stored = await unsafeDb.attachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(stored.storageKey.startsWith("HMNL/deal/")).toBe(true);

    const snmnl = await ctxFor("exec.snmnl.1");
    await expect(notes.readAttachment(snmnl, att.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(notes.listNotes(snmnl, "Deal", id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(notes.readAttachment(abuja, att.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await scopedDb(snmnl).note.count()).toBe(0);
  });

  it("rejects oversized and disallowed files", async () => {
    const { id } = await newDeal(exec);
    await expect(notes.addAttachment(exec, "Deal", id, { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array(10) })).rejects.toThrow(/Allowed files/);
    await expect(notes.addAttachment(exec, "Deal", id, { name: "big.pdf", type: "application/pdf", bytes: new Uint8Array(notes.MAX_ATTACHMENT_BYTES + 1) })).rejects.toThrow(/10 MB/);
  });
});

describe("pipeline setup", () => {
  it("only administrators can change stages; changes are audited", async () => {
    const stage = stageIds.get("ENQUIRY")!;
    const input = { name: "Enquiry", probability: 15, maxDaysInStage: 5, requiredFields: ["colour", "bogus"], allowedTransitions: null };
    await expect(svc.updatePipelineStage(bm, stage, input)).rejects.toBeInstanceOf(NotFoundError);
    const admin = await ctxFor("admin");
    const after = await svc.updatePipelineStage(admin, stage, input);
    expect(after.probability).toBe(15);
    expect(after.requiredFields).toEqual(["colour"]);
    expect(await unsafeDb.auditLog.count({ where: { entity: "PipelineStage", entityId: stage } })).toBe(1);
    await svc.updatePipelineStage(admin, stage, { name: "Enquiry", probability: 10, maxDaysInStage: 7, requiredFields: [], allowedTransitions: null });

    const pipelineId = (await unsafeDb.pipelineStage.findUniqueOrThrow({ where: { id: stage } })).pipelineId;
    const added = await svc.addPipelineStage(admin, pipelineId, "Insurance check");
    expect(added.key).toBe("INSURANCE_CHECK");
    const order = (await unsafeDb.pipelineStage.findMany({ where: { pipelineId }, orderBy: { order: "asc" } })).map((s) => s.key);
    expect(order.slice(-3)).toEqual(["INSURANCE_CHECK", "CLOSED_WON", "CLOSED_LOST"]);
    await svc.deletePipelineStage(admin, added.id);
    await expect(svc.deletePipelineStage(admin, stageIds.get("CLOSED_WON")!)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
