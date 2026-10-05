import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { clearSetupCaches } from "@/server/db/setup-store";
import * as approvals from "@/server/modules/approvals/service";
import * as docs from "@/server/modules/doctpl/service";
import { getDocument } from "@/server/modules/documents/queries";
import * as emailTemplates from "@/server/modules/email/templates";
import { createCampaign } from "@/server/modules/messaging/campaigns";
import * as rec from "@/server/modules/rectpl/service";
import { saveSetting } from "@/server/modules/setup/service";
import * as hub from "@/server/modules/templates/hub";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

/**
 * Templates hub and record templates (prompt 22 §6): module list, views, brand isolation, create-from-template,
 * "template required", and deleting templates that are in use.
 */
let admin: AccessContext;
let superadmin: AccessContext;
let crmadmin: AccessContext; // Administrator, not a Super Admin
let hmnlExec: AccessContext;
let snmnlExec: AccessContext;
let multiExec: AccessContext;
let bmHmnl: AccessContext;
let ba: AccessContext; // Brand Admin of HMNL
let id: Awaited<ReturnType<typeof ids>>;
const lagos = () => id.region("Lagos");
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);
const emailDoc = { blocks: [{ type: "text", html: "<p>Hello {{contact.firstName | \"Customer\"}}</p>" }] };

beforeAll(async () => {
  [admin, superadmin, crmadmin, hmnlExec, snmnlExec, multiExec, bmHmnl, ba] = (await Promise.all(["admin", "superadmin", "crmadmin", "exec.hmnl.1", "exec.snmnl.1", "exec.multi.1", "bm.hmnl", "ba.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
});

describe("New Template → Select Module", () => {
  it("lists the modules of the template type the user can read, in the fixed order; unreadable modules are hidden", () => {
    expect(hub.modulesFor(admin, "record").map((m) => m.key)).toEqual(["leads", "contacts", "accounts", "deals", "quotes", "cases"]);
    expect(hub.modulesFor(admin, "email").map((m) => m.key)).toEqual(["leads", "contacts", "accounts", "deals", "quotes", "salesOrders", "invoices", "cases"]);
    expect(hub.modulesFor(admin, "sms").map((m) => m.key)).toEqual(["leads", "deals", "cases"]);
    const all = hub.modulesFor(admin, "document").map((m) => m.key);
    expect(all).toEqual(["leads", "contacts", "accounts", "deals", "activities", "products", "quotes", "salesOrders", "inventoryDocuments", "invoices", "campaigns", "priceBooks", "cases", "vehicleUnits"]);
    // a profile without read access to cases and inventory does not get those modules offered
    const limited = { ...hmnlExec, profile: { ...hmnlExec.profile, permissions: { ...hmnlExec.profile.permissions, cases: {}, inventory: {} } } } as AccessContext;
    const offered = hub.modulesFor(limited, "document").map((m) => m.key);
    expect(offered).toContain("deals");
    expect(offered).not.toContain("cases");
    expect(offered).not.toContain("vehicleUnits");
    expect(offered).not.toContain("inventoryDocuments");
    expect(hub.modulesFor(limited, "record").map((m) => m.key)).not.toContain("cases");
  });
});

describe("record templates", () => {
  let walkIn: string;

  it("a Brand Admin creates and publishes a lead template for the own brand; values are validated against the module", async () => {
    const body = { name: "Walk-in showroom enquiry", description: "Showroom visitor", fieldValues: { source: "WALK_IN", rating: "WARM", regionId: { $: "userRegion" }, ownerId: { $: "currentUser" }, paymentIntent: "CASH" }, lockedFields: ["source"], hiddenFields: ["rating"], childRecords: [{ subject: "Follow up in 24 h", type: "CALL" as const, dueInHours: 24, priority: "HIGH" as const }] };
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { ...body, fieldValues: { source: "TELEPATHY" } })).rejects.toThrow(/is not one of/);
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { ...body, fieldValues: { mobile: "+2348030000000" } })).rejects.toThrow(/belongs to one customer/);
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { ...body, fieldValues: { nothing: "x" } })).rejects.toThrow(/not a field/);
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { ...body, fieldValues: { budget: { $: "currentUser" } } })).rejects.toThrow(/does not fit/);
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("SNMNL"), visibility: "SHARED_BRAND" }, body)).rejects.toThrow(/not found/i);
    await expect(rec.createRecordTemplate(ba, { module: "leads", brandId: null, visibility: "PUBLIC_GROUP" }, body)).rejects.toThrow(/administrators/);
    await expect(rec.createRecordTemplate(hmnlExec, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, body)).rejects.toThrow(/brand's manager/);
    await expect(rec.createRecordTemplate(ba, { module: "invoices", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, body)).rejects.toThrow(/not available for this module/);

    const t = await rec.createRecordTemplate(ba, { module: "leads", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, body);
    walkIn = t.id;
    // a draft is not offered
    expect(names(await rec.pickerTemplates(hmnlExec, "leads"))).not.toContain("Walk-in showroom enquiry");
    await expect(rec.resolveForUse(hmnlExec, t.id, "leads")).rejects.toThrow(/not found/i);
    await rec.publishRecordTemplate(ba, t.id);
    expect(names(await rec.pickerTemplates(hmnlExec, "leads"))).toContain("Walk-in showroom enquiry");
    // user sessions cannot read the tables
    await expect(rawAsUser(hmnlExec, `SELECT id FROM "RecordTemplate"`)).rejects.toThrow(/permission denied/);
  });

  it("create from template: locked and hidden fields win, other fields keep what the user typed; tasks and the template link are stored", async () => {
    const resolved = await rec.resolveForUse(hmnlExec, walkIn, "leads");
    expect(resolved.values).toMatchObject({ source: "WALK_IN", rating: "WARM", brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, regionId: lagos() });
    expect(resolved.locked.sort()).toEqual(["brandId", "source"]);
    expect(resolved.hidden).toEqual(["rating"]);

    const made = await rec.createFromTemplate(hmnlExec, "leads", walkIn, { lastName: "Template Lead", mobile: "+2348035550101", source: "FACEBOOK", rating: "HOT", paymentIntent: "BANK_FINANCE", brandId: id.brand("SNMNL") });
    const lead = await unsafeDb.lead.findUniqueOrThrow({ where: { id: made.id } });
    expect(lead).toMatchObject({ lastName: "Template Lead", source: "WALK_IN", rating: "WARM", paymentIntent: "BANK_FINANCE", brandId: id.brand("HMNL"), regionId: lagos(), ownerId: hmnlExec.userId });
    expect(made).toMatchObject({ templateId: walkIn, templateVersion: 1, tasks: 1 });
    const task = await unsafeDb.activity.findFirstOrThrow({ where: { parentType: "Lead", parentId: made.id } });
    expect(task).toMatchObject({ type: "CALL", subject: "Follow up in 24 h", priority: "HIGH", brandId: id.brand("HMNL") });
    expect(await rec.templateOfRecord(hmnlExec, "leads", made.id)).toEqual({ createdFromTemplateId: walkIn, createdFromTemplateVersion: 1, templateName: "Walk-in showroom enquiry" });
    await expect(rec.templateOfRecord(snmnlExec, "leads", made.id)).rejects.toThrow(/not found/i);
    const t = await rec.getRecordTemplate(ba, walkIn);
    expect(t).toMatchObject({ usageCount: 1, usedThisMonth: 1 });
    expect(await unsafeDb.auditLog.count({ where: { entity: "RecordTemplateUse", entityId: made.id } })).toBe(1);
    // a used template is kept for reporting
    await expect(rec.deleteRecordTemplate(ba, walkIn)).rejects.toThrow(/archive it instead/);
  });

  it("an HMNL template does not exist for SNMNL users; an 'all my brands' template cannot create a record in a brand the user is not in", async () => {
    await expect(rec.resolveForUse(snmnlExec, walkIn, "leads")).rejects.toThrow(/not found/i);
    await expect(rec.getRecordTemplate(snmnlExec, walkIn)).rejects.toThrow(/not found/i);
    await expect(rec.createFromTemplate(snmnlExec, "leads", walkIn, { lastName: "X", mobile: "+2348035550102" })).rejects.toThrow(/not found/i);
    expect(names(await rec.listRecordTemplates(snmnlExec))).not.toContain("Walk-in showroom enquiry");
    expect((await hub.hubList(snmnlExec, { tab: "record" })).rows.map((r) => r.name)).not.toContain("Walk-in showroom enquiry");
    await expect(hub.setFavorite(snmnlExec, "record", walkIn, true)).rejects.toThrow(/not found/i);
    await expect(hub.cloneTemplate(snmnlExec, "record", walkIn)).rejects.toThrow(/not found/i);

    const everywhere = await rec.createRecordTemplate(admin, { module: "leads", brandId: null, visibility: "PUBLIC_GROUP" }, { name: "Referral lead", fieldValues: { source: "REFERRAL", regionId: { $: "userRegion" } }, lockedFields: ["source"] });
    await rec.publishRecordTemplate(admin, everywhere.id);
    // the HMNL exec may use it for HMNL …
    const ok = await rec.createFromTemplate(hmnlExec, "leads", everywhere.id, { lastName: "Referral", mobile: "+2348035550103", brandId: id.brand("HMNL") });
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: ok.id } })).source).toBe("REFERRAL");
    // … but not to create an SNMNL record
    await expect(rec.createFromTemplate(hmnlExec, "leads", everywhere.id, { lastName: "Wrong brand", mobile: "+2348035550104", brandId: id.brand("SNMNL") })).rejects.toThrow(/not found/i);
    expect(await unsafeDb.lead.count({ where: { lastName: "Wrong brand" } })).toBe(0);
    // a user of both brands can
    const sn = await rec.createFromTemplate(multiExec, "leads", everywhere.id, { lastName: "Referral SN", mobile: "+2348035550105", brandId: id.brand("SNMNL"), regionId: multiExec.memberships.find((m) => m.brandId === id.brand("SNMNL") && m.regionId)!.regionId });
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: sn.id } })).brandId).toBe(id.brand("SNMNL"));
  });

  it("a quote template adds line items priced from the CURRENT price book – never a stored price", async () => {
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, stage: { type: "OPEN" }, deletedAt: null }, select: { id: true } });
    const product = await unsafeDb.product.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), active: true }, select: { id: true } });
    const foreign = await unsafeDb.product.findFirstOrThrow({ where: { brandId: id.brand("SNMNL") }, select: { id: true } });
    await expect(rec.createRecordTemplate(ba, { module: "quotes", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { name: "Wrong product", fieldValues: {}, lineItems: [{ productId: foreign.id, qty: 1 }] })).rejects.toThrow(/not found|template's brand/i);
    const t = await rec.createRecordTemplate(ba, { module: "quotes", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { name: "Standard offer", fieldValues: { terms: "Valid for 14 days. Delivery ex-showroom." }, lineItems: [{ productId: product.id, qty: 2, discountPct: 0 }] });
    await rec.publishRecordTemplate(ba, t.id);
    expect(JSON.stringify((await unsafeDb.recordTemplate.findUniqueOrThrow({ where: { id: t.id } })).lineItems)).not.toMatch(/price/i);

    const setPrice = async (price: number) => {
      await unsafeDb.product.update({ where: { id: product.id }, data: { listPrice: price } });
      await unsafeDb.priceBookEntry.updateMany({ where: { productId: product.id }, data: { price } });
    };
    await setPrice(21_000_000);
    const first = await rec.createFromTemplate(hmnlExec, "quotes", t.id, { dealId: deal.id });
    const q1 = await getDocument(hmnlExec, "quote", first.id);
    expect(q1.lines).toHaveLength(1);
    expect(Number(q1.lines[0]!.unitPrice)).toBe(21_000_000);
    expect(Number(q1.lines[0]!.qty)).toBe(2);
    expect(q1.terms).toBe("Valid for 14 days. Delivery ex-showroom.");
    await setPrice(23_500_000);
    const second = await rec.createFromTemplate(hmnlExec, "quotes", t.id, { dealId: deal.id });
    expect(Number((await getDocument(hmnlExec, "quote", second.id)).lines[0]!.unitPrice)).toBe(23_500_000);
    expect(await rec.templateOfRecord(hmnlExec, "quotes", second.id)).toMatchObject({ createdFromTemplateId: t.id });
    await expect(rec.createFromTemplate(hmnlExec, "quotes", t.id, {})).rejects.toThrow(/dealId/);
    const snDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("SNMNL") }, select: { id: true } });
    await expect(rec.createFromTemplate(hmnlExec, "quotes", t.id, { dealId: snDeal.id })).rejects.toThrow(/not found/i);
  });

  it("a brand manager's shared template needs the Brand Admin's approval; save-as-template leaves out the customer's identity", async () => {
    const t = await rec.createRecordTemplate(bmHmnl, { module: "cases", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { name: "Delivery complaint", fieldValues: { type: "DELIVERY_ISSUE", priority: "HIGH" }, lockedFields: ["type"] });
    await expect(rec.publishRecordTemplate(bmHmnl, t.id)).rejects.toThrow(/submit it for approval/);
    expect((await rec.submitRecordTemplate(bmHmnl, t.id)).status).toBe("PENDING");
    const task = (await approvals.myApprovalTasks(ba)).find((x) => x.entityId === t.id)!;
    expect(task.kind).toBe("RECORD_TEMPLATE");
    await approvals.decide(ba, task.requestId, true);
    expect((await rec.getRecordTemplate(bmHmnl, t.id)).status).toBe("PUBLISHED");
    const made = await rec.createFromTemplate(hmnlExec, "cases", t.id, { subject: "Late delivery", type: "ENQUIRY", brandId: id.brand("HMNL"), regionId: lagos(), customerName: "Someone" });
    expect(await unsafeDb.case.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ type: "DELIVERY_ISSUE", priority: "HIGH", subject: "Late delivery" });
    // a change by the manager sends it back to draft until approved again
    expect(await rec.saveRecordTemplate(bmHmnl, t.id, { name: "Delivery complaint", fieldValues: { type: "DELIVERY_ISSUE", priority: "MEDIUM" } })).toEqual({ version: 2, status: "DRAFT" });

    const lead = await unsafeDb.lead.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, deletedAt: null }, select: { id: true, source: true } });
    const saved = await rec.saveRecordAsTemplate(hmnlExec, "leads", lead.id, "From my lead");
    const mine = await rec.getRecordTemplate(hmnlExec, saved.id);
    expect(mine).toMatchObject({ visibility: "PERSONAL", status: "DRAFT", brandId: id.brand("HMNL") });
    expect(mine.fieldValues.source).toBe(lead.source);
    for (const personal of ["firstName", "lastName", "mobile", "email", "ownerId", "status"]) expect(mine.fieldValues).not.toHaveProperty(personal);
    await expect(rec.saveRecordAsTemplate(snmnlExec, "leads", lead.id, "x")).rejects.toThrow(/not found/i);
    await expect(rec.getRecordTemplate(bmHmnl, saved.id)).rejects.toThrow(/not found/i); // personal
  });

  it("'require a template' blocks blank creation of the module; with a template it works", async () => {
    await saveSetting(admin, "recordTemplatePolicy", { leads: true, deals: false, cases: false, accounts: false, contacts: false });
    clearSetupCaches();
    try {
      const blank = { lastName: "Blank", mobile: "+2348035550106", brandId: id.brand("HMNL"), regionId: lagos() };
      await expect(rec.createWithTemplate(hmnlExec, "leads", null, blank, async () => ({ id: "never" }))).rejects.toThrow(/created from a template/);
      await expect(rec.createWithTemplate(hmnlExec, "leads", "", blank, async () => ({ id: "never" }))).rejects.toThrow(/created from a template/);
      expect((await rec.createFromTemplate(hmnlExec, "leads", walkIn, { lastName: "With template", mobile: "+2348035550107" })).id).toBeTruthy();
      // other modules are not affected
      const { input, ref } = await rec.applyTemplate(hmnlExec, "deals", null, { name: "x" });
      expect([input, ref]).toEqual([{ name: "x" }, null]);
    } finally {
      await saveSetting(admin, "recordTemplatePolicy", { leads: false, deals: false, cases: false, accounts: false, contacts: false });
      clearSetupCaches();
    }
    await expect(saveSetting(bmHmnl, "recordTemplatePolicy", { leads: true, deals: false, cases: false, accounts: false, contacts: false })).rejects.toThrow();
  });
});

describe("hub: views, favourites, folders, row actions", () => {
  let hmnlEmail: string;
  let groupEmail: string;
  let hmnlDoc: string;

  it("one list over all template types; tabs, filters and search", async () => {
    hmnlEmail = (await emailTemplates.saveRichTemplate(bmHmnl, null, { brandId: id.brand("HMNL"), name: "Hub booking confirmation", module: "deals", folder: null, category: "Sales", subject: "Booking confirmed", doc: emailDoc, active: true })).id;
    groupEmail = (await emailTemplates.saveRichTemplate(admin, null, { brandId: null, name: "Hub group newsletter", module: null, folder: null, category: "Marketing", subject: "News", doc: emailDoc, active: true })).id;
    await emailTemplates.saveRichTemplate(admin, null, { brandId: id.brand("SNMNL"), name: "Hub Nissan only", module: "deals", folder: null, category: "Sales", subject: "Nissan", doc: emailDoc, active: true });
    hmnlDoc = (await docs.createTemplate(ba, { name: "Hub offer letter", module: "deals", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND", starter: "deal-offer-letter" })).id;
    await docs.publishTemplate(ba, hmnlDoc);

    const email = await hub.hubList(hmnlExec, { tab: "email" });
    expect(email.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["Hub booking confirmation", "Hub group newsletter"]));
    expect(email.rows.map((r) => r.name)).not.toContain("Hub Nissan only");
    expect(email.rows.every((r) => r.kind === "email")).toBe(true);
    expect(email.rows.find((r) => r.id === hmnlEmail)).toMatchObject({ moduleLabel: "Deals", brandCode: "HMNL", status: "Published", scope: "Shared", ownerName: bmHmnl.user.name, mine: false, editable: false });
    expect((await hub.hubList(bmHmnl, { tab: "email" })).rows.find((r) => r.id === hmnlEmail)).toMatchObject({ mine: true, editable: true });

    const document = await hub.hubList(hmnlExec, { tab: "document" });
    expect(document.rows.find((r) => r.id === hmnlDoc)).toMatchObject({ kind: "document", status: "Published", scope: "Shared" });
    const record = await hub.hubList(hmnlExec, { tab: "record" });
    expect(record.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["Walk-in showroom enquiry", "Referral lead", "From my lead"]));
    expect(record.tabCounts.email).toBe(email.rows.length);

    // filters and search
    expect((await hub.hubList(hmnlExec, { tab: "email", module: "deals" })).rows.map((r) => r.name)).toContain("Hub booking confirmation");
    expect((await hub.hubList(hmnlExec, { tab: "email", module: "deals" })).rows.map((r) => r.name)).not.toContain("Hub group newsletter");
    expect((await hub.hubList(hmnlExec, { tab: "email", brand: "all" })).rows.every((r) => r.brandId === null)).toBe(true);
    expect((await hub.hubList(hmnlExec, { tab: "email", brand: id.brand("SNMNL") })).rows).toEqual([]); // not a brand of the user: nothing
    expect((await hub.hubList(hmnlExec, { tab: "email", q: "booking confirmed" })).rows.map((r) => r.id)).toEqual([hmnlEmail]); // subject is searched
    expect((await hub.hubList(hmnlExec, { tab: "record", status: "Draft" })).rows.map((r) => r.name)).toEqual(["From my lead"]);
    expect((await hub.hubList(hmnlExec, { tab: "record", sort: "name" })).rows.map((r) => r.name)).toEqual([...record.rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)));
    // the API gives the same scoped list
    const api = await hub.hubApiList(hmnlExec, "email", "deals");
    expect(api.map((t) => t.name)).toContain("Hub booking confirmation");
    expect((await hub.hubApiList(snmnlExec, null, null)).map((t) => t.name)).not.toContain("Hub booking confirmation");
  });

  it("left-panel views: favourites are per user; associated = used by a campaign, workflow rule or record template; mine, shared, public", async () => {
    await hub.setFavorite(hmnlExec, "email", hmnlEmail, true);
    await hub.setFavorite(hmnlExec, "email", groupEmail, true);
    await hub.setFavorite(hmnlExec, "email", groupEmail, false);
    expect((await hub.hubList(hmnlExec, { tab: "email", view: "favorites" })).rows.map((r) => r.id)).toEqual([hmnlEmail]);
    expect((await hub.hubList(bmHmnl, { tab: "email", view: "favorites" })).rows).toEqual([]);
    expect((await hub.hubList(hmnlExec, { tab: "email" })).viewCounts.favorites).toBe(1);

    expect((await hub.hubList(bmHmnl, { tab: "email", view: "associated" })).rows.map((r) => r.id)).not.toContain(hmnlEmail);
    await createCampaign(bmHmnl, { name: "Hub campaign", brandId: id.brand("HMNL"), channel: "EMAIL", type: "PROMO", templateId: hmnlEmail });
    await unsafeDb.workflowRule.create({ data: { name: "Hub rule sends the offer letter", module: "deals", trigger: "ON_CREATE", triggerConfig: {}, criteria: {}, actions: [{ type: "SEND_DOCUMENT", documentTemplate: `doc:${hmnlDoc}` }], active: true } });
    const linked = await rec.createRecordTemplate(ba, { module: "deals", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" }, { name: "Fleet deal", fieldValues: { paymentType: "FLEET", closeDate: { $: "today+45d" } }, childRecords: [{ subject: "Credit check" }, { subject: "Proposal" }], documentTemplateId: hmnlDoc });
    const associated = await hub.hubList(bmHmnl, { tab: "email", view: "associated" });
    expect(associated.rows.find((r) => r.id === hmnlEmail)!.associated).toEqual(["Campaign: Hub campaign"]);
    const docRow = (await hub.hubList(bmHmnl, { tab: "document", view: "associated" })).rows.find((r) => r.id === hmnlDoc)!;
    expect(docRow.associated.sort()).toEqual(["Record template: Fleet deal", "Workflow rule: Hub rule sends the offer letter"]);

    expect((await hub.hubList(bmHmnl, { tab: "email", view: "mine" })).rows.map((r) => r.id)).toEqual([hmnlEmail]);
    expect((await hub.hubList(hmnlExec, { tab: "email", view: "shared" })).rows.map((r) => r.id)).toContain(hmnlEmail);
    expect((await hub.hubList(hmnlExec, { tab: "email", view: "shared" })).rows.map((r) => r.id)).not.toContain(groupEmail);
    expect((await hub.hubList(hmnlExec, { tab: "email", view: "public" })).rows.map((r) => r.id)).toContain(groupEmail);
    expect((await hub.hubList(hmnlExec, { tab: "email", view: "public" })).rows.map((r) => r.id)).not.toContain(hmnlEmail);

    // the template's close date formula resolves when it is used
    await rec.publishRecordTemplate(ba, linked.id);
    const deal = await rec.createFromTemplate(hmnlExec, "deals", linked.id, { name: "Fleet for Acme", brandId: id.brand("HMNL"), regionId: lagos() });
    const row = await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.paymentType).toBe("FLEET");
    expect(Math.round((row.closeDate!.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(44);
    expect(deal.tasks).toBe(2);
    expect(deal.next).toContain(`/email/compose?type=Deal&id=${deal.id}&doc=doc%3A${hmnlDoc}`);
  });

  it("deleting a template that is in use is blocked with the list of where; only a Super Admin can; unused ones are deleted", async () => {
    await expect(hub.deleteTemplate(bmHmnl, "email", hmnlEmail)).rejects.toThrow(/in use and cannot be deleted.*Campaign: Hub campaign/);
    await expect(hub.deleteTemplate(crmadmin, "document", hmnlDoc)).rejects.toThrow(/Workflow rule: Hub rule sends the offer letter/);
    expect(await unsafeDb.documentTemplate.count({ where: { id: hmnlDoc } })).toBe(1);
    // archive instead: no longer offered, still there
    await hub.archiveTemplate(bmHmnl, "email", hmnlEmail, true);
    expect((await hub.hubList(bmHmnl, { tab: "email" })).rows.find((r) => r.id === hmnlEmail)!.status).toBe("Inactive");
    await hub.archiveTemplate(bmHmnl, "email", hmnlEmail, false);
    await expect(hub.archiveTemplate(hmnlExec, "email", hmnlEmail, true)).rejects.toThrow(/cannot change/);

    const unused = await emailTemplates.saveRichTemplate(bmHmnl, null, { brandId: id.brand("HMNL"), name: "Hub unused", module: null, folder: null, category: "Service", subject: "x", doc: emailDoc, active: true });
    await hub.setFavorite(hmnlExec, "email", unused.id, true);
    await expect(hub.deleteTemplate(hmnlExec, "email", unused.id)).rejects.toThrow(/brand's manager/);
    await hub.deleteTemplate(bmHmnl, "email", unused.id);
    expect(await unsafeDb.template.count({ where: { id: unused.id } })).toBe(0);
    expect(await unsafeDb.templateFavorite.count({ where: { templateId: unused.id } })).toBe(0);
    // a Super Admin may delete an associated record-linked document template only when nothing was generated with it
    const viaSuper = await docs.createTemplate(admin, { name: "Hub super", module: "deals", brandId: null, visibility: "GROUP" });
    await unsafeDb.workflowRule.create({ data: { name: "Hub rule 2", module: "deals", trigger: "ON_CREATE", triggerConfig: {}, criteria: {}, actions: [{ type: "SEND_DOCUMENT", documentTemplate: `doc:${viaSuper.id}` }], active: true } });
    await expect(hub.deleteTemplate(crmadmin, "document", viaSuper.id)).rejects.toThrow(/in use/);
    await hub.deleteTemplate(superadmin, "document", viaSuper.id);
    expect(await unsafeDb.documentTemplate.count({ where: { id: viaSuper.id } })).toBe(0);
  });

  it("folders: personal ones are the user's; shared brand folders are managed by the brand; clone and default go through the type's rules", async () => {
    const own = await hub.createFolder(hmnlExec, { name: "My follow-ups", shared: false, brandId: null });
    await expect(hub.createFolder(hmnlExec, { name: "Team", shared: true, brandId: id.brand("HMNL") })).rejects.toThrow(/manager, its Brand Admin/);
    await expect(hub.createFolder(bmHmnl, { name: "Group", shared: true, brandId: null })).rejects.toThrow(/administrators/);
    await expect(hub.createFolder(bmHmnl, { name: "Nissan", shared: true, brandId: id.brand("SNMNL") })).rejects.toThrow(/not found/i);
    const team = await hub.createFolder(bmHmnl, { name: "Sales follow-ups", shared: true, brandId: id.brand("HMNL") });

    await hub.moveToFolder(hmnlExec, "email", hmnlEmail, own.id);
    expect((await hub.hubList(hmnlExec, { tab: "email", folder: own.id })).rows.map((r) => r.id)).toEqual([hmnlEmail]);
    expect((await hub.hubList(bmHmnl, { tab: "email", folder: own.id })).rows.length).toBeGreaterThan(1); // not their folder: the filter is ignored
    expect((await hub.hubList(bmHmnl, { tab: "email" })).folders.map((f) => f.name)).toEqual(["Sales follow-ups"]);
    await expect(hub.moveToFolder(hmnlExec, "email", hmnlEmail, team.id)).rejects.toThrow(/manage this shared folder/);
    await hub.moveToFolder(bmHmnl, "email", groupEmail, team.id);
    expect((await hub.hubList(hmnlExec, { tab: "email", folder: team.id })).rows.map((r) => r.id)).toEqual([groupEmail]);
    expect((await hub.hubList(snmnlExec, { tab: "email" })).folders).toEqual([]);
    expect((await hub.hubList(snmnlExec, { tab: "email" })).rows.find((r) => r.id === groupEmail)!.folderId).toBeNull(); // a brand folder places nothing for other brands
    await hub.moveToFolder(hmnlExec, "email", hmnlEmail, "");
    expect((await hub.hubList(hmnlExec, { tab: "email", folder: own.id })).rows).toEqual([]);
    await expect(hub.deleteFolder(hmnlExec, team.id)).rejects.toThrow(/cannot remove/);
    await hub.deleteFolder(bmHmnl, team.id);

    // clone: the exec gets a personal copy of the shared document template; the default is the Brand Admin's to set
    const copy = await hub.cloneTemplate(hmnlExec, "document", hmnlDoc);
    const cloned = (await hub.hubList(hmnlExec, { tab: "document", view: "mine" })).rows.find((r) => copy.href.endsWith(r.id))!;
    expect(cloned).toMatchObject({ name: "Hub offer letter (copy)", scope: "Personal", status: "Draft" });
    await expect(hub.setDefault(hmnlExec, "document", hmnlDoc, true)).rejects.toThrow(/Brand Admin or an administrator/);
    await hub.setDefault(ba, "document", hmnlDoc, true);
    expect((await hub.hubList(hmnlExec, { tab: "document" })).rows.find((r) => r.id === hmnlDoc)!.isDefault).toBe(true);
    await expect(hub.setDefault(ba, "email", hmnlEmail, true)).rejects.toThrow(/Only document and record templates/);
    await expect(hub.cloneTemplate(hmnlExec, "email", hmnlEmail)).rejects.toThrow(/permission|brand's manager/); // e-mail templates are copied by people who may write them
  });
});
