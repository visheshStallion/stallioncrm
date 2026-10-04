/**
 * Brand-isolation matrix (prompt 15 §1). For EVERY brand-owned model and every persona the rows the
 * application returns are compared with an independent reference implementation of the visibility rule – through
 * the scoped client, through raw SQL under row-level security, and through the access paths users actually
 * take (list, get by id, search, related lists, report, dashboard, export, webhook payload, notification,
 * offline cache). The named VT-xx tests are the go-live visibility tests of BUSINESS_CONTEXT §11.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BRAND_OWNED_MODELS, delegateName } from "@/server/access/brand-owned";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { eventPayload } from "@/server/integrations/webhooks";
import { recordActivities } from "@/server/modules/activities/queries";
import { softDelete } from "@/server/modules/api/records";
import { decide, myApprovalTasks, requestBrandChange } from "@/server/modules/approvals/service";
import { listProducts } from "@/server/modules/catalogue/queries";
import { getAccount } from "@/server/modules/customers/queries";
import { loadDashboard } from "@/server/modules/dashboards/service";
import { getDeal, listDeals } from "@/server/modules/deals/queries";
import { updateDeal } from "@/server/modules/deals/service";
import { dealDocuments, getDocument } from "@/server/modules/documents/queries";
import * as docs from "@/server/modules/documents/service";
import { exportList } from "@/server/modules/exports/service";
import { intakeLead } from "@/server/modules/leads/intake";
import { getLead } from "@/server/modules/leads/queries";
import { convertLead } from "@/server/modules/leads/service";
import { addNote, listAttachments, listNotes, readAttachment } from "@/server/modules/notes/service";
import { snapshot } from "@/server/modules/offline/service";
import { runSavedReport } from "@/server/modules/reports/service";
import { globalSearch } from "@/server/modules/search/queries";
import { ctxFor, rawAsUser, unsafeDb } from "../integration/helpers";
import { buildFixture, type Fixture, type Persona } from "./fixture";

let F: Fixture;
let P: Fixture["personas"];
type Ref = { id: string; brandId: string; regionId: string; ownerId: string | null };

/** Independent reference implementation of the visibility rule (BUSINESS_CONTEXT §5) – deliberately not imported from src. */
function mayRead(ctx: AccessContext, r: Ref): boolean {
  if (ctx.scope === "ALL") return true;
  if (r.ownerId && r.ownerId === ctx.userId) return true;
  return ctx.memberships.some((m) => m.brandId === r.brandId && (m.regionId === null || m.regionId === r.regionId));
}
const sorted = (ids: string[]) => [...ids].sort();
const inFixture = () => ({ brandId: { in: [F.brands.A.id, F.brands.B.id] } });
const personaList = () => Object.values(P) as Persona[];

beforeAll(async () => {
  F = await buildFixture();
  P = F.personas;
}, 300_000);

describe("every brand-owned model × every persona", () => {
  const MODELS = [...BRAND_OWNED_MODELS].sort();

  it("the fixture has rows of every brand-owned model in both brands (the matrix is not vacuous)", async () => {
    for (const model of MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
      const rows = await (unsafeDb as any)[delegateName(model)].groupBy({ by: ["brandId"], where: inFixture(), _count: { _all: true } });
      expect(rows.length, `${model} rows in both fixture brands`).toBe(model === "ApprovalRequest" ? 1 : 2);
    }
  });

  it.each(MODELS)("%s: scoped client and raw SQL return exactly the rows the rule allows", async (model) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
    const all: Ref[] = await (unsafeDb as any)[delegateName(model)].findMany({ where: { deletedAt: null }, select: { id: true, brandId: true, regionId: true, ownerId: true } });
    for (const p of personaList()) {
      const expected = sorted(all.filter((r) => mayRead(p.ctx, r)).map((r) => r.id));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (scopedDb(p.ctx) as any)[delegateName(model)];
      const viaClient: Array<{ id: string }> = await delegate.findMany({ select: { id: true } });
      expect(sorted(viaClient.map((r) => r.id)), `${model} via scopedDb as ${p.label}`).toEqual(expected);
      expect(await delegate.count(), `${model} count as ${p.label}`).toBe(expected.length);
      const viaSql = await rawAsUser<{ id: string }>(p.ctx, `SELECT id FROM "${model}" WHERE "deletedAt" IS NULL`);
      expect(sorted(viaSql.map((r) => r.id)), `${model} via RLS as ${p.label}`).toEqual(expected);
      // by id: a hidden row does not exist
      const hidden = all.find((r) => !mayRead(p.ctx, r));
      if (hidden) {
        expect(await delegate.findUnique({ where: { id: hidden.id } }), `${model} hidden row by id as ${p.label}`).toBeNull();
        expect(await delegate.findFirst({ where: { id: hidden.id } })).toBeNull();
        expect((await delegate.updateMany({ where: { id: hidden.id }, data: {} })).count).toBe(0);
      }
    }
  });

  it("without a user context row-level security returns nothing", async () => {
    for (const model of MODELS) {
      const rows = await unsafeDb.$transaction([unsafeDb.$executeRawUnsafe("SET LOCAL ROLE stallion_rls"), unsafeDb.$queryRawUnsafe<unknown[]>(`SELECT id FROM "${model}" LIMIT 5`)]);
      expect(rows[1], model).toEqual([]);
    }
  });
});

describe("every access path", () => {
  it("list, get by id, related lists, search, export, webhook payload, offline cache follow the rule for each persona", async () => {
    const deals: Array<Ref & { name: string }> = await unsafeDb.deal.findMany({ where: { ...inFixture(), deletedAt: null }, select: { id: true, name: true, brandId: true, regionId: true, ownerId: true } });
    for (const p of personaList()) {
      const can = deals.filter((d) => mayRead(p.ctx, d));
      const cannot = deals.filter((d) => !mayRead(p.ctx, d));
      // list
      const listed = (await listDeals(p.ctx, {}, { take: 5000 })).rows.filter((r) => deals.some((d) => d.id === r.id));
      expect(sorted(listed.map((r) => r.id)), `deal list as ${p.label}`).toEqual(sorted(can.map((d) => d.id)));
      // brand filter of the UI can only narrow
      const narrowed = (await listDeals(p.ctx, { brandId: F.brands.B.id }, { take: 5000 })).rows.filter((r) => deals.some((d) => d.id === r.id));
      // (a brand the persona has no access to is ignored as a filter – either way nothing outside `can` comes back)
      expect(narrowed.every((r) => can.some((d) => d.id === r.id)), `brand filter as ${p.label}`).toBe(true);
      if (p.ctx.scope === "ALL" || p.ctx.memberships.some((m) => m.brandId === F.brands.B.id)) expect(narrowed.every((r) => r.brandId === F.brands.B.id)).toBe(true);
      for (const d of cannot) {
        const cell = F.cells.find((c) => c.dealId === d.id)!;
        // get by id and every related list: 404, never 403
        await expect(getDeal(p.ctx, d.id), `get hidden deal as ${p.label}`).rejects.toBeInstanceOf(NotFoundError);
        // related lists of a hidden record: "not found" or simply nothing – never a row
        for (const related of [() => dealDocuments(p.ctx, d.id), () => listNotes(p.ctx, "Deal", d.id), () => listAttachments(p.ctx, "Deal", d.id)]) {
          const out = await related().catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
          expect(JSON.stringify(out ?? []), `related list of a hidden deal as ${p.label}`).not.toMatch(/"id":/);
        }
        expect(await recordActivities(p.ctx, "Deal", d.id).then((g) => [...g.overdue, ...g.upcoming, ...g.history]).catch(() => [])).toEqual([]);
        for (const [type, id] of [["quote", cell.quoteId], ["salesOrder", cell.orderId], ["invoice", cell.invoiceId]] as const) await expect(getDocument(p.ctx, type, id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(getLead(p.ctx, cell.leadId)).rejects.toBeInstanceOf(NotFoundError);
        // attachment download by id (the service behind GET /api/v1/attachments/:id)
        const attachment = await unsafeDb.attachment.findFirstOrThrow({ where: { entity: "Deal", entityId: d.id }, select: { id: true } });
        await expect(readAttachment(p.ctx, attachment.id), `download hidden attachment as ${p.label}`).rejects.toBeInstanceOf(NotFoundError);
        // search: by name and by VIN
        expect((await globalSearch(p.ctx, d.name)).filter((h) => h.id === d.id || h.brandId === d.brandId && h.regionId === d.regionId), `search hidden deal as ${p.label}`).toEqual([]);
        expect((await globalSearch(p.ctx, cell.vin)).map((h) => h.id)).not.toContain(d.id);
        // webhook payload built for this principal
        expect(await eventPayload(p.ctx, "Deal", d.id), `webhook payload as ${p.label}`).toBeNull();
        expect(await eventPayload(p.ctx, "Invoice", cell.invoiceId)).toBeNull();
      }
      for (const d of can.slice(0, 2)) {
        expect((await getDeal(p.ctx, d.id)).id).toBe(d.id);
        expect((await globalSearch(p.ctx, d.name)).map((h) => h.id)).toContain(d.id);
        expect(((await eventPayload(p.ctx, "Deal", d.id)) as { id: string }).id).toBe(d.id);
      }
      // offline cache: the user's own records only – always a subset of what they may see
      const snap = await snapshot(p.ctx);
      for (const r of [...snap.deals, ...snap.leads] as Array<{ id: string; brandId: string; regionId: string }>) {
        const row = deals.find((d) => d.id === r.id);
        if (row) expect(mayRead(p.ctx, row) && row.ownerId === p.ctx.userId, `offline cache as ${p.label}`).toBe(true);
      }
      // export: needs the permission; contains exactly the visible fixture deals
      if (p.ctx.profile.permissions.deals?.export) {
        const out = await exportList(p.ctx, "deals", "csv", {});
        const csv = out.kind === "file" ? new TextDecoder().decode(out.body) : "";
        if (out.kind === "file") {
          for (const d of can) expect(csv, `export as ${p.label}`).toContain(d.name);
          for (const d of cannot) expect(csv).not.toContain(d.name);
        }
      } else await expect(exportList(p.ctx, "deals", "csv", {})).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("reports and dashboards aggregate only what the persona may see", async () => {
    for (const p of personaList()) {
      if (!p.ctx.profile.permissions.reports?.read) continue;
      const { result } = await runSavedReport(p.ctx, "pipeline-by-stage-brand");
      const text = JSON.stringify(result.rows);
      const seesA = p.ctx.scope === "ALL" || p.ctx.memberships.some((m) => m.brandId === F.brands.A.id) || F.cells.some((c) => c.brand === "A" && mayRead(p.ctx, { id: c.dealId, brandId: c.brandId, regionId: c.regionId, ownerId: null }));
      const seesB = p.ctx.scope === "ALL" || p.ctx.memberships.some((m) => m.brandId === F.brands.B.id);
      expect(text.includes(F.brands.A.code), `report shows brand A to ${p.label}`).toBe(seesA);
      expect(text.includes(F.brands.B.code), `report shows brand B to ${p.label}`).toBe(seesB);
      const board = await loadDashboard(p.ctx, "my");
      const dump = JSON.stringify(board.widgets);
      if (!seesB) expect(dump).not.toContain(F.brands.B.code);
      if (!seesA) expect(dump).not.toContain(F.brands.A.code);
    }
  });

  it("notifications: mentioning someone without access to the record does not reach them", async () => {
    const cell = F.cell("A", "R1");
    const before = await unsafeDb.notification.count({ where: { userId: P.execB1.ctx.userId } });
    await addNote(P.execA1.ctx, "Deal", cell.dealId, "Please look at this", [P.execB1.ctx.userId, P.execA1b.ctx.userId]).catch(() => undefined);
    expect(await unsafeDb.notification.count({ where: { userId: P.execB1.ctx.userId } })).toBe(before);
  });
});

describe("go-live visibility tests (BUSINESS_CONTEXT §11)", () => {
  const dealsOf = async (ctx: AccessContext) => (await listDeals(ctx, {}, { take: 5000 })).rows.filter((r) => [F.brands.A.id, F.brands.B.id].includes(r.brandId));

  it("VT-01 brand A city exec – deals list: only brand A, own region", async () => {
    const rows = await dealsOf(P.execA1.ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.brandId === F.brands.A.id && r.regionId === F.regions.R1.id)).toBe(true);
  });

  it("VT-02 brand A city exec – search for a known brand B deal: no result", async () => {
    const b = F.cell("B", "R1");
    expect((await globalSearch(P.execA1.ctx, b.dealName)).filter((h) => h.brandId === F.brands.B.id)).toEqual([]);
    expect((await globalSearch(P.execA1.ctx, b.vin)).map((h) => h.id)).not.toContain(b.dealId);
  });

  it("VT-03 brand A city exec – shared customer: visible; only brand A related records; sensitive fields hidden", async () => {
    const account = await getAccount(P.execA1.ctx, F.accountId);
    expect(account.id).toBe(F.accountId);
    const related = (await scopedDb(P.execA1.ctx).deal.findMany({ where: { accountId: F.accountId }, select: { brandId: true, regionId: true } }));
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((d) => d.brandId === F.brands.A.id && d.regionId === F.regions.R1.id)).toBe(true);
    // a user of a brand the customer has no relationship with sees the customer exists, with the contact details masked
    const stranger = await getAccount(await ctxFor("exec.thpl.1"), F.accountId);
    const full = await unsafeDb.account.findUniqueOrThrow({ where: { id: F.accountId } });
    expect(stranger.name).toBe(full.name);
    expect(JSON.stringify(stranger)).not.toContain(full.email!.split("@")[0]!);
    expect(JSON.stringify(stranger)).not.toContain(full.phone!);
  });

  it("VT-04 brand A city exec – change brand: API 403", async () => {
    await expect(updateDeal(P.execA1.ctx, F.cell("A", "R1").dealId, { brandId: F.brands.B.id } as never)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: F.cell("A", "R1").dealId } })).brandId).toBe(F.brands.A.id);
  });

  it("VT-05 brand A city exec – export / mass delete: 403", async () => {
    await expect(exportList(P.execA1.ctx, "deals", "csv", {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportList(P.execA1.ctx, "leads", "xlsx", {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(softDelete(P.execA1.ctx, "deals", F.cell("A", "R1").dealId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(softDelete(P.execA1.ctx, "deals", F.cell("B", "R1").dealId)).rejects.toSatisfy((e) => e instanceof ForbiddenError || e instanceof NotFoundError);
  });

  it("VT-06 brand A city exec – product lookup: only brand A products", async () => {
    const rows = (await listProducts(P.execA1.ctx, { take: 500 })).rows;
    expect(rows.map((r) => r.id)).toContain(F.productA);
    expect(rows.every((r) => r.brandId === F.brands.A.id)).toBe(true);
    expect((await listProducts(P.execA1.ctx, { brandId: F.brands.B.id, take: 500 })).rows).toEqual([]);
  });

  it("VT-07 multi-brand rep – deals of both brands, own region only", async () => {
    const rows = await dealsOf(P.multi.ctx);
    expect(new Set(rows.map((r) => r.brandId))).toEqual(new Set([F.brands.A.id, F.brands.B.id]));
    expect(rows.every((r) => r.regionId === F.regions.R1.id)).toBe(true);
  });

  it("VT-08 regional exec – all brands, own regional office only", async () => {
    const rows = await dealsOf(P.regional.ctx);
    expect(new Set(rows.map((r) => r.brandId))).toEqual(new Set([F.brands.A.id, F.brands.B.id]));
    expect(rows.every((r) => r.regionId === F.regions.R2.id)).toBe(true);
  });

  it("VT-09 Regional Sales Manager – all brands for the regional offices, not the city", async () => {
    const rows = await dealsOf(P.rsm.ctx);
    expect(new Set(rows.map((r) => r.brandId))).toEqual(new Set([F.brands.A.id, F.brands.B.id]));
    expect(rows.every((r) => r.regionId === F.regions.R2.id)).toBe(true);
    await expect(getDeal(P.rsm.ctx, F.cell("A", "R1").dealId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("VT-10 Brand Manager A – all regions of brand A, no other brand", async () => {
    const rows = await dealsOf(P.bmA.ctx);
    expect(new Set(rows.map((r) => r.regionId))).toEqual(new Set([F.regions.R1.id, F.regions.R2.id]));
    expect(rows.every((r) => r.brandId === F.brands.A.id)).toBe(true);
  });

  it("VT-11 Brand Manager A – discount approval of brand A: visible and actionable", async () => {
    const tasks = await myApprovalTasks(P.bmA.ctx);
    const task = tasks.find((t) => t.brandId === F.brands.A.id)!;
    expect(task, "a pending discount approval for brand A").toBeTruthy();
    const out = await decide(P.bmA.ctx, task.requestId, true, "ok");
    expect(out.status).toBe("APPROVED");
  });

  it("VT-12 Brand Manager B – brand A approval: not visible, not actionable", async () => {
    // a fresh request for brand A
    const exec = P.execA1.ctx;
    const quote = await docs.createQuoteFromDeal(exec, F.cell("A", "R1").dealId);
    const line = await unsafeDb.documentLine.findFirstOrThrow({ where: { quoteId: quote.id } });
    await docs.saveDocument(exec, "quote", quote.id, { lines: [{ productId: line.productId, description: line.description, qty: 1, unitPrice: 30_000_000, discountPct: 9, taxRate: 7.5 }] } as never);
    const res = (await docs.submitQuote(exec, quote.id)) as { approvalRequestId?: string };
    expect(res.approvalRequestId).toBeTruthy();
    expect((await myApprovalTasks(P.bmB.ctx)).filter((t) => t.brandId === F.brands.A.id)).toEqual([]);
    await expect(decide(P.bmB.ctx, res.approvalRequestId!, true)).rejects.toSatisfy((e) => e instanceof NotFoundError || e instanceof ForbiddenError);
    expect(await rawAsUser(P.bmB.ctx, `SELECT id FROM "ApprovalRequest" WHERE id = '${res.approvalRequestId}'`)).toEqual([]);
  });

  it("VT-13 Head of Sales – group view: all brands and regions", async () => {
    const rows = await dealsOf(P.hos.ctx);
    expect(rows.map((r) => r.id).sort()).toEqual(F.cells.map((c) => c.dealId).sort());
    const board = await loadDashboard(P.hos.ctx, "group");
    expect(board.widgets.length).toBeGreaterThan(0);
  });

  it("VT-14 web form of brand A, regional office: lead gets brand A and goes round-robin to that territory's exec", async () => {
    const res = await intakeLead(F.brands.A.code, { lastName: `Webform ${F.tag}`, mobile: "08039990001", region: F.regions.R2.name }, { source: "WEBSITE", ip: "203.0.113.9" });
    expect(res.status).toBe("created");
    const lead = await unsafeDb.lead.findFirstOrThrow({ where: { lastName: `Webform ${F.tag}` } });
    expect(lead).toMatchObject({ brandId: F.brands.A.id, regionId: F.regions.R2.id });
    // members of the A–R2 territory: the regional-office exec, the regional exec and the RSM
    expect([P.execA2.ctx.userId, P.regional.ctx.userId, P.rsm.ctx.userId]).toContain(lead.ownerId);
    expect(lead.ownerId).not.toBe(P.execB1.ctx.userId);
    // a form cannot choose another brand than the one in its address
    const forged = await intakeLead(F.brands.A.code, { lastName: `Forged ${F.tag}`, mobile: "08039990002", region: F.regions.R1.name, brandId: F.brands.B.id, brand: F.brands.B.code }, { source: "WEBSITE", ip: "203.0.113.9" });
    expect(forged.status).toBe("created");
    expect((await unsafeDb.lead.findFirstOrThrow({ where: { lastName: `Forged ${F.tag}` } })).brandId).toBe(F.brands.A.id);
  });

  it("VT-15 convert lead → deal → quote: brand and region inherited; the brand's pipeline and price book", async () => {
    const cell = F.cell("A", "R1");
    await convertLead(P.execA1.ctx, cell.leadId, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: `Converted ${F.tag}` } });
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { name: `Converted ${F.tag}` }, include: { stage: { include: { pipeline: true } } } });
    expect(deal).toMatchObject({ brandId: F.brands.A.id, regionId: F.regions.R1.id });
    expect(deal.stage!.pipeline.brandId).toBe(F.brands.A.id);
    await unsafeDb.deal.update({ where: { id: deal.id }, data: { modelId: F.productA } });
    const quote = await docs.createQuoteFromDeal(P.execA1.ctx, deal.id);
    const q = await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(q).toMatchObject({ brandId: F.brands.A.id, regionId: F.regions.R1.id });
    expect(q.number.startsWith(F.brands.A.code)).toBe(true);
    const book = q.priceBookId ? await unsafeDb.priceBook.findUnique({ where: { id: q.priceBookId } }) : null;
    expect(book?.brandId ?? F.brands.A.id).toBe(F.brands.A.id);
  });

  it("VT-16 brand change A → B: approval by both brand managers; audit entry (VT-17)", async () => {
    const deal = await unsafeDb.deal.create({ data: { name: `Move me ${F.tag}`, brandId: F.brands.A.id, regionId: F.regions.R1.id, ownerId: P.execA1.ctx.userId, stageId: (await unsafeDb.pipelineStage.findFirstOrThrow({ where: { pipeline: { brandId: F.brands.A.id }, type: "OPEN" }, orderBy: { order: "asc" } })).id } });
    const req = (await requestBrandChange(P.execA1.ctx, "Deal", deal.id, { newBrandId: F.brands.B.id, newOwnerId: P.execB1.ctx.userId, reason: "Customer prefers brand B" })) as { requestId: string; status: string };
    expect(req.status).toBe("PENDING");
    // nothing moves before both managers agree
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).brandId).toBe(F.brands.A.id);
    const first = await decide(P.bmA.ctx, req.requestId, true);
    expect(first.status).toBe("PENDING");
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).brandId).toBe(F.brands.A.id);
    const second = await decide(P.bmB.ctx, req.requestId, true);
    expect(second.status).toBe("APPROVED");
    const moved = await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(moved).toMatchObject({ brandId: F.brands.B.id, ownerId: P.execB1.ctx.userId });
    // the old brand's exec no longer sees it
    await expect(getDeal(P.execA1b.ctx, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    // VT-17: the brand / owner change is in the audit log, which is append-only
    const entries = await unsafeDb.auditLog.findMany({ where: { entity: "Deal", entityId: deal.id }, orderBy: { at: "asc" } });
    const change = entries.find((e) => JSON.stringify(e.after ?? {}).includes(F.brands.B.id));
    expect(change, "audit entry of the brand change").toBeTruthy();
    expect(JSON.stringify(change!.before ?? {})).toContain(F.brands.A.id);
    await expect(unsafeDb.auditLog.update({ where: { id: change!.id }, data: { entity: "Tampered" } })).rejects.toThrow(/append-only/);
    await expect(unsafeDb.auditLog.delete({ where: { id: change!.id } })).rejects.toThrow(/append-only/);
    await expect(rawAsUser(P.admin.ctx, `SELECT id FROM "AuditLog" LIMIT 1`)).rejects.toThrow(/permission denied/); // read only through the admin service
  });
});
