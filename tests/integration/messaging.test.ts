import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { applyDeliveryStatus, unsubscribeByToken } from "@/server/db/messaging-system";
import { BadRequestError } from "@/server/errors";
import { recordActivities } from "@/server/modules/activities/queries";
import { createDeal } from "@/server/modules/deals/service";
import { convertLead, createLead } from "@/server/modules/leads/service";
import * as campaigns from "@/server/modules/messaging/campaigns";
import { sandboxOutbox, setSandboxFailure } from "@/server/modules/messaging/providers";
import { receiveInbound, recordMessages, sendMessage } from "@/server/modules/messaging/service";
import { myNotifications } from "@/server/modules/notifications/service";
import { createReport } from "@/server/modules/reports/service";
import { runDueJobs } from "@/server/modules/workflow/engine";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let multi: AccessContext; // HMNL + SNMNL Lagos exec
let snmnl: AccessContext; // SNMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let bmSnmnl: AccessContext;
let rsm: AccessContext;
let hos: AccessContext;

const HMNL_WA = "+2348100000001";
const SNMNL_WA = "+2348100000002";
let seq = 0;
const phone = () => `+23480${String(70000000 + Math.floor(Math.random() * 9_000_000) + seq++).padStart(8, "0")}`;
const rnd = () => Math.random().toString(36).slice(2, 8);
const last = () => sandboxOutbox[sandboxOutbox.length - 1]!;

beforeAll(async () => {
  I = await ids();
  [exec, multi, snmnl, bm, bmSnmnl, rsm, hos] = (await Promise.all(["exec.hmnl.1", "exec.multi.1", "exec.snmnl.1", "bm.hmnl", "bm.snmnl", "rsm", "hos"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { fromName: "HMNL Sales", fromEmail: "sales@hmnl.example.test", smsSenderId: "HMNL", smsInboundNumber: "30001", whatsappNumber: HMNL_WA, whatsappPhoneId: "wa-hmnl" } });
  await unsafeDb.brand.update({ where: { id: I.brand("SNMNL") }, data: { fromName: "SNMNL Sales", fromEmail: "sales@snmnl.example.test", smsSenderId: "SNMNL", smsInboundNumber: "30002", whatsappNumber: SNMNL_WA, whatsappPhoneId: "wa-snmnl" } });
});
beforeEach(() => setSandboxFailure(null));

const lead = (ctx: AccessContext, brand: string, over: Record<string, unknown> = {}) =>
  createLead(ctx, { firstName: "Tunde", lastName: `Msg ${rnd()}`, mobile: phone(), email: `tunde.${rnd()}@example.test`, brandId: I.brand(brand), regionId: I.region("Lagos"), source: "WALK_IN", ...over } as never);
/** A customer (contact) with a deal in the given brand. */
async function customer(ctx: AccessContext, brand: string, over: { mobile?: string; email?: string; consent?: boolean } = {}) {
  const l = await lead(ctx, brand, { mobile: over.mobile ?? phone(), email: over.email ?? `cust.${rnd()}@example.test`, consentMarketing: over.consent ?? false });
  const res = await convertLead(ctx, l.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: `Campaign deal ${rnd()}` } } as never);
  return { leadId: l.id, ...res };
}
async function drain() {
  for (let i = 0; i < 30; i++) {
    await unsafeDb.job.updateMany({ where: { status: { in: ["QUEUED", "FAILED"] } }, data: { runAt: new Date() } }); // ignore the throttle delay
    const { done, failed } = await runDueJobs(100);
    if (done + failed === 0) break;
  }
}

describe("sender identity per brand", () => {
  it("a message about an HMNL record is sent as HMNL, about an SNMNL record as SNMNL", async () => {
    const h = await lead(multi, "HMNL");
    const s = await lead(multi, "SNMNL");
    const sms = await sendMessage(multi, { channel: "SMS", parentType: "Lead", parentId: h.id, body: "Hello {{contact.firstName}}, your {{brand.name}} test drive is confirmed." });
    expect(sms).toMatchObject({ status: "SENT", from: "HMNL" });
    expect(last()).toMatchObject({ channel: "SMS", from: { address: "HMNL" } });
    expect(last().text).toMatch(/^Hello Tunde, your .+ test drive is confirmed\.$/);
    expect(last().text).not.toContain("{{");

    const mail = await sendMessage(multi, { channel: "EMAIL", parentType: "Lead", parentId: s.id, subject: "Offer from {{brand.code}}", body: "Dear {{contact.name}},\nyour advisor {{owner.name}} will call you." });
    expect(mail).toMatchObject({ status: "SENT", from: "sales@snmnl.example.test" });
    expect(last()).toMatchObject({ channel: "EMAIL", subject: "Offer from SNMNL", from: { name: "SNMNL Sales", address: "sales@snmnl.example.test" } });
    expect(last().text).toContain(multi.user.name);

    // a brand without a configured sender never borrows another brand's identity
    const t = await lead(await ctxFor("exec.thpl.1"), "THPL");
    await expect(sendMessage(await ctxFor("exec.thpl.1"), { channel: "SMS", parentType: "Lead", parentId: t.id, body: "Hi" })).rejects.toThrow(/THPL has no SMS sender/);
    // deals use the contact of the deal
    const c = await customer(exec, "HMNL");
    const onDeal = await sendMessage(exec, { channel: "EMAIL", parentType: "Deal", parentId: c.dealId, subject: "Your {{deal.name}}", body: "Thank you" });
    expect(onDeal.from).toBe("sales@hmnl.example.test");
  });

  it("is logged as an activity and message on the record – invisible to other brands", async () => {
    const h = await lead(exec, "HMNL");
    const sent = await sendMessage(exec, { channel: "SMS", parentType: "Lead", parentId: h.id, body: "Secret HMNL price offer" });
    const history = (await recordActivities(exec, "Lead", h.id)).history;
    expect(history[0]).toMatchObject({ id: sent.activityId, type: "SMS_LOG", status: "COMPLETED", description: "Secret HMNL price offer", direction: "OUTBOUND" });
    expect((await recordMessages(exec, "Lead", h.id))[0]).toMatchObject({ channel: "SMS", direction: "OUT", status: "SENT", fromAddress: "HMNL" });
    // another brand: cannot send on it, cannot read it – neither through the service nor through SQL
    await expect(sendMessage(snmnl, { channel: "SMS", parentType: "Lead", parentId: h.id, body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await recordMessages(snmnl, "Lead", h.id)).toEqual([]);
    expect(await rawAsUser(snmnl, `SELECT id FROM "Message" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    expect(await rawAsUser(snmnl, `SELECT id FROM "Activity" WHERE id = '${sent.activityId}'`)).toEqual([]);
    // provider failure: the attempt stays on the record as FAILED
    setSandboxFailure(() => "Gateway rejected the number");
    const failed = await sendMessage(exec, { channel: "SMS", parentType: "Lead", parentId: h.id, body: "Second try" });
    expect(failed).toMatchObject({ status: "FAILED", error: "Gateway rejected the number" });
    expect((await recordMessages(exec, "Lead", h.id))[0]).toMatchObject({ status: "FAILED", error: "Gateway rejected the number" });
    // no address → 400
    const noMail = await lead(exec, "HMNL", { email: "" });
    await expect(sendMessage(exec, { channel: "EMAIL", parentType: "Lead", parentId: noMail.id, body: "x" })).rejects.toThrow(/no valid email/);
  });

  it("WhatsApp free text needs an open 24-hour session; otherwise an approved template", async () => {
    const mobile = phone();
    const h = await lead(exec, "HMNL", { mobile });
    await expect(sendMessage(exec, { channel: "WHATSAPP", parentType: "Lead", parentId: h.id, body: "Hi there" })).rejects.toThrow(/approved template/);
    const tpl = await campaigns.saveTemplate(bm, null, { brandId: I.brand("HMNL"), channel: "WHATSAPP", name: "Test drive reminder", body: "Hello {{contact.firstName}}, see you at the showroom.", whatsappStatus: "APPROVED", whatsappName: "test_drive_reminder" });
    const viaTemplate = await sendMessage(exec, { channel: "WHATSAPP", parentType: "Lead", parentId: h.id, templateId: tpl.id });
    expect(viaTemplate).toMatchObject({ status: "SENT", from: HMNL_WA });
    expect(last()).toMatchObject({ whatsappTemplate: { name: "test_drive_reminder", parameters: ["Tunde"] }, from: { whatsappPhoneId: "wa-hmnl" } });
    // the customer answers → free text is allowed
    expect((await receiveInbound({ channel: "WHATSAPP", receiver: "wa-hmnl", from: mobile, text: "Can I come at 3pm?", providerMessageId: `wamid.${rnd()}` })).status).toBe("logged");
    expect((await sendMessage(exec, { channel: "WHATSAPP", parentType: "Lead", parentId: h.id, body: "Yes, 3pm works." })).status).toBe("SENT");
  });
});

describe("inbound routing by receiving number", () => {
  it("the same customer lands in the brand whose number received the message", async () => {
    const mobile = phone();
    const h = await lead(multi, "HMNL", { mobile });
    const s = await lead(multi, "SNMNL", { mobile });
    const toHmnl = await receiveInbound({ channel: "WHATSAPP", receiver: HMNL_WA, from: mobile.replace("+234", "0"), text: "Is the SUV available?", providerMessageId: `wamid.${rnd()}` });
    expect(toHmnl).toMatchObject({ status: "logged", brandCode: "HMNL", parentType: "Lead", parentId: h.id });
    const toSnmnl = await receiveInbound({ channel: "SMS", receiver: "30002", from: mobile, text: "Please call me", providerMessageId: `sms.${rnd()}` });
    expect(toSnmnl).toMatchObject({ status: "logged", brandCode: "SNMNL", parentId: s.id });
    expect((await recordMessages(multi, "Lead", h.id)).map((m) => m.body)).toEqual(["Is the SUV available?"]);
    expect((await recordMessages(multi, "Lead", s.id)).map((m) => m.body)).toEqual(["Please call me"]);
    const inbound = (await recordActivities(multi, "Lead", h.id)).history[0]!;
    expect(inbound).toMatchObject({ type: "WHATSAPP_LOG", direction: "INBOUND", ownerId: multi.userId });
    expect((await myNotifications(multi, 50)).rows.some((n) => n.href === `/leads/${h.id}` && n.title.includes("WhatsApp"))).toBe(true);
    // an HMNL-only exec never sees the SNMNL conversation
    expect(await rawAsUser(exec, `SELECT id FROM "Message" WHERE "parentId" = '${s.id}'`)).toEqual([]);
  });

  it("known customers are matched to the open deal of that brand; unknown senders become a lead of that brand", async () => {
    const mobile = phone();
    const c = await customer(snmnl, "SNMNL", { mobile });
    expect(await receiveInbound({ channel: "WHATSAPP", receiver: SNMNL_WA, from: mobile, text: "When is delivery?", providerMessageId: `wamid.${rnd()}` })).toMatchObject({ status: "logged", brandCode: "SNMNL", parentType: "Deal", parentId: c.dealId });
    // the same customer writes to HMNL, where they are unknown → a new HMNL lead (not the SNMNL deal)
    const viaHmnl = await receiveInbound({ channel: "WHATSAPP", receiver: HMNL_WA, from: mobile, text: "Do you have pickups?", senderName: "Ngozi Bello", providerMessageId: `wamid.${rnd()}` });
    expect(viaHmnl).toMatchObject({ status: "lead_created", brandCode: "HMNL", parentType: "Lead" });
    const created = await unsafeDb.lead.findUniqueOrThrow({ where: { id: viaHmnl.parentId! } });
    expect(created).toMatchObject({ brandId: I.brand("HMNL"), regionId: I.region("Lagos"), mobile, source: "WHATSAPP", firstName: "Ngozi", lastName: "Bello" });
    const owner = await unsafeDb.territoryMember.findFirst({ where: { userId: created.ownerId, territory: { brandId: I.brand("HMNL") } } });
    expect(owner).not.toBeNull(); // assigned to someone who works for HMNL
    expect(await rawAsUser(snmnl, `SELECT id FROM "Lead" WHERE id = '${created.id}'`)).toEqual([]);
    // the next message from that number goes to the lead that now exists
    expect(await receiveInbound({ channel: "WHATSAPP", receiver: HMNL_WA, from: mobile, text: "Hello?", providerMessageId: `wamid.${rnd()}` })).toMatchObject({ status: "logged", parentId: created.id });
  });

  it("ignores unknown receiving numbers and duplicates; STOP opts out of that brand only", async () => {
    const mobile = phone();
    expect((await receiveInbound({ channel: "WHATSAPP", receiver: "+2348199999999", from: mobile, text: "Hi" })).status).toBe("ignored");
    expect((await receiveInbound({ channel: "SMS", receiver: "30001", from: "not-a-number", text: "Hi" })).status).toBe("ignored");
    const h = await lead(multi, "HMNL", { mobile, consentMarketing: true });
    const s = await lead(multi, "SNMNL", { mobile, consentMarketing: true });
    const id = `sms.${rnd()}`;
    expect((await receiveInbound({ channel: "SMS", receiver: "30001", from: mobile, text: "STOP", providerMessageId: id })).status).toBe("logged");
    expect((await receiveInbound({ channel: "SMS", receiver: "30001", from: mobile, text: "STOP", providerMessageId: id })).status).toBe("ignored"); // provider retry
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: h.id } })).consentMarketing).toBe(false);
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: s.id } })).consentMarketing).toBe(true);
    expect(await unsafeDb.message.count({ where: { parentId: h.id, direction: "IN" } })).toBe(1);
  });
});

describe("templates", () => {
  it("brand templates belong to the brand's manager; group templates to management", async () => {
    const t = await campaigns.saveTemplate(bm, null, { brandId: I.brand("HMNL"), channel: "EMAIL", name: "HMNL promo", subject: "News from {{brand.name}}", body: "Dear {{contact.firstName}} {{contact.nickname}}" });
    expect(t.unknownFields).toEqual(["contact.nickname"]);
    await expect(campaigns.saveTemplate(bmSnmnl, t.id, { channel: "EMAIL", name: "hijack", subject: "x", body: "x" })).rejects.toBeInstanceOf(NotFoundError); // invisible to SNMNL
    await expect(campaigns.saveTemplate(exec, t.id, { channel: "EMAIL", name: "x", subject: "x", body: "x" })).rejects.toBeInstanceOf(ForbiddenError); // exec of the brand: visible, not editable
    await expect(campaigns.saveTemplate(bm, null, { brandId: I.brand("SNMNL"), channel: "SMS", name: "x", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(campaigns.saveTemplate(bm, null, { brandId: null, channel: "SMS", name: "group", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(campaigns.saveTemplate(bm, null, { brandId: I.brand("HMNL"), channel: "EMAIL", name: "no subject", body: "x" })).rejects.toBeInstanceOf(BadRequestError);
    const group = await campaigns.saveTemplate(hos, null, { brandId: null, channel: "SMS", name: "Group greeting", body: "Thank you for choosing {{brand.name}}." });
    const forSnmnl = await campaigns.templatesFor(snmnl, I.brand("SNMNL"), "SMS");
    expect(forSnmnl.map((x) => x.id)).toContain(group.id);
    expect((await campaigns.listTemplates(bmSnmnl)).some((x) => x.id === t.id)).toBe(false);
    await expect(rawAsUser(bmSnmnl, `UPDATE "Template" SET name = 'x' WHERE id = '${t.id}' RETURNING id`)).resolves.toEqual([]);
    // a template of another brand cannot be used on a record
    const s = await lead(snmnl, "SNMNL");
    await expect(sendMessage(snmnl, { channel: "EMAIL", parentType: "Lead", parentId: s.id, templateId: t.id })).rejects.toThrow(/not available/);
    await campaigns.deleteTemplate(bm, t.id);
  });
});

describe("campaigns", () => {
  it("permissions: only own brands; launching needs the massEmail permission", async () => {
    await expect(campaigns.createCampaign(exec, { brandId: I.brand("HMNL"), name: "x", channel: "SMS" })).rejects.toBeInstanceOf(ForbiddenError); // Sales Exec: no campaigns
    await expect(campaigns.createCampaign(bm, { brandId: I.brand("SNMNL"), name: "x", channel: "SMS" })).rejects.toBeInstanceOf(ForbiddenError);
    const c = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: "Visible to HMNL only", channel: "SMS" });
    expect(c.code).toMatch(/^HMNL-\d{4}-[0-9A-F]{6}$/);
    await expect(campaigns.getCampaign(bmSnmnl, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await campaigns.listCampaigns(bmSnmnl)).some((x) => x.id === c.id)).toBe(false);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "Campaign" WHERE id = '${c.id}'`)).toEqual([]);
    // the RSM may prepare campaigns for their brands but not send
    const regional = await campaigns.createCampaign(rsm, { brandId: I.brand("HMNL"), name: "Regional", channel: "SMS" });
    await expect(campaigns.launchCampaign(rsm, regional.id)).rejects.toBeInstanceOf(ForbiddenError);
    // a template of another brand cannot be attached (service and DB trigger)
    const foreign = await campaigns.saveTemplate(bmSnmnl, null, { brandId: I.brand("SNMNL"), channel: "SMS", name: "SNMNL only", body: "x" });
    await expect(campaigns.updateCampaign(bm, c.id, { name: "x", channel: "SMS", templateId: foreign.id })).rejects.toBeInstanceOf(BadRequestError);
    await expect(unsafeDb.campaign.update({ where: { id: c.id }, data: { templateId: foreign.id } })).rejects.toThrow(/another brand/);
  });

  it("the audience respects consent per brand and never contains another brand's customers", async () => {
    const shared = phone();
    // one person, customer of both brands: consented to HMNL, opted out of SNMNL
    const inHmnl = await customer(multi, "HMNL", { mobile: shared, consent: true });
    const inSnmnl = await customer(multi, "SNMNL", { mobile: shared });
    const contactId = inHmnl.contactId;
    await unsafeDb.deal.update({ where: { id: inSnmnl.dealId }, data: { contactId } });
    await unsafeDb.contactBrandConsent.upsert({ where: { contactId_brandId: { contactId, brandId: I.brand("SNMNL") } }, update: { consent: false }, create: { contactId, brandId: I.brand("SNMNL"), consent: false } });
    // an SNMNL-only customer who consented to SNMNL
    const snmnlOnly = await customer(snmnl, "SNMNL", { consent: true });
    // HMNL customers without any consent record, and without a mobile number
    const noConsent = await customer(exec, "HMNL");
    const noMobile = await customer(exec, "HMNL", { consent: true });
    await unsafeDb.contact.update({ where: { id: noMobile.contactId }, data: { mobile: null } });

    const h = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: `HMNL promo ${rnd()}`, channel: "SMS", audience: { kind: "ALL_CUSTOMERS" } });
    const built = await campaigns.buildAudience(bm, h.id);
    expect(built.noAddress).toBeGreaterThanOrEqual(1);
    const members = await unsafeDb.campaignMember.findMany({ where: { campaignId: h.id } });
    const by = (id: string) => members.find((m) => m.contactId === id);
    expect(by(contactId)).toMatchObject({ status: "PENDING", address: shared, dealId: inHmnl.dealId });
    expect(by(noConsent.contactId)).toMatchObject({ status: "SUPPRESSED", reason: "No marketing consent recorded for HMNL" });
    expect(by(noMobile.contactId)).toBeUndefined();
    // the HMNL manager cannot target SNMNL-only customers
    expect(by(snmnlOnly.contactId)).toBeUndefined();
    const hmnlContacts = new Set((await unsafeDb.deal.findMany({ where: { brandId: I.brand("HMNL"), contactId: { not: null } }, select: { contactId: true } })).map((d) => d.contactId));
    expect(members.every((m) => m.contactId && hmnlContacts.has(m.contactId))).toBe(true);

    // the same person in an SNMNL campaign: suppressed – they opted out of SNMNL
    const s = await campaigns.createCampaign(bmSnmnl, { brandId: I.brand("SNMNL"), name: `SNMNL promo ${rnd()}`, channel: "SMS", audience: { kind: "ALL_CUSTOMERS" } });
    await campaigns.buildAudience(bmSnmnl, s.id);
    const sMembers = await unsafeDb.campaignMember.findMany({ where: { campaignId: s.id } });
    expect(sMembers.find((m) => m.contactId === contactId)).toMatchObject({ status: "SUPPRESSED", reason: "Opted out of SNMNL marketing" });
    expect(sMembers.find((m) => m.contactId === snmnlOnly.contactId)).toMatchObject({ status: "PENDING" });

    // audience from a saved report shared by the Head of Sales: still only the creator's (HMNL) records
    const report = await createReport(hos, { name: `All deals ${rnd()}`, folder: "GROUP", definition: { module: "deals", columns: ["name"], filters: [] } });
    const r = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: `From report ${rnd()}`, channel: "SMS", audience: { kind: "REPORT", reportId: report.id } });
    await campaigns.buildAudience(bm, r.id);
    const rMembers = await unsafeDb.campaignMember.findMany({ where: { campaignId: r.id } });
    expect(rMembers.length).toBeGreaterThan(0);
    expect(rMembers.every((m) => m.contactId && hmnlContacts.has(m.contactId))).toBe(true);
    expect(rMembers.some((m) => m.contactId === snmnlOnly.contactId)).toBe(false);
    // lead audiences use the lead's own consent
    const yes = await lead(exec, "HMNL", { consentMarketing: true });
    const no = await lead(exec, "HMNL");
    const l = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: `Leads ${rnd()}`, channel: "EMAIL", audience: { kind: "ALL_LEADS" } });
    await campaigns.buildAudience(bm, l.id);
    const lMembers = await unsafeDb.campaignMember.findMany({ where: { campaignId: l.id, leadId: { in: [yes.id, no.id] } } });
    expect(lMembers.find((m) => m.leadId === yes.id)?.status).toBe("PENDING");
    expect(lMembers.find((m) => m.leadId === no.id)?.status).toBe("SUPPRESSED");
  });

  it("launch: throttled sending as the brand, consent re-checked, delivery reports, unsubscribe and ROI", async () => {
    const [a, b, gone] = [await customer(exec, "HMNL", { consent: true }), await customer(exec, "HMNL", { consent: true }), await customer(exec, "HMNL", { consent: true })];
    const tpl = await campaigns.saveTemplate(bm, null, { brandId: I.brand("HMNL"), channel: "EMAIL", name: `Launch ${rnd()}`, subject: "New model from {{brand.name}}", body: "Dear {{contact.firstName}}, visit us this weekend." });
    const report = await createReport(bm, { name: `Launch audience ${rnd()}`, definition: { module: "deals", columns: ["name"], filters: [{ field: "name", op: "contains", value: "Campaign deal" }] } });
    const c = await campaigns.createCampaign(bm, { brandId: I.brand("HMNL"), name: `Launch ${rnd()}`, type: "LAUNCH", channel: "EMAIL", budget: 1_000_000, audience: { kind: "REPORT", reportId: report.id } });
    await expect(campaigns.launchCampaign(bm, c.id)).rejects.toThrow(/template/);
    await campaigns.updateCampaign(bm, c.id, { name: "Launch", type: "LAUNCH", channel: "EMAIL", budget: 1_000_000, templateId: tpl.id, audience: { kind: "REPORT", reportId: report.id } });
    await expect(campaigns.launchCampaign(bm, c.id)).rejects.toThrow(/Build the audience/);
    const built = await campaigns.buildAudience(bm, c.id);
    expect(built.pending).toBeGreaterThanOrEqual(3);
    // one customer opts out after the audience was built
    await unsafeDb.contactBrandConsent.update({ where: { contactId_brandId: { contactId: gone.contactId, brandId: I.brand("HMNL") } }, data: { consent: false } });

    const before = sandboxOutbox.length;
    const launched = await campaigns.launchCampaign(bm, c.id);
    expect(launched.batches).toBe(Math.ceil(built.pending / 25));
    await expect(campaigns.launchCampaign(bm, c.id)).rejects.toThrow(/already launched/);
    await drain();
    const members = await unsafeDb.campaignMember.findMany({ where: { campaignId: c.id } });
    const of = (contactId: string) => members.find((m) => m.contactId === contactId)!;
    expect(of(a.contactId).status).toBe("SENT");
    expect(of(gone.contactId)).toMatchObject({ status: "SUPPRESSED", reason: "Opted out of HMNL marketing before sending" });
    expect((await unsafeDb.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("SENT");
    const sentNow = sandboxOutbox.slice(before);
    expect(sentNow.length).toBe(built.pending - 1);
    expect(sentNow.every((m) => m.from.address === "sales@hmnl.example.test" && m.subject!.startsWith("New model from"))).toBe(true);
    const toA = sentNow.find((m) => m.to === of(a.contactId).address)!;
    expect(toA.text).toContain("Dear Tunde, visit us this weekend.");
    expect(toA.text).toContain(`/api/public/unsubscribe/${of(a.contactId).unsubscribeToken}`);
    expect(toA.unsubscribeUrl).toContain(of(a.contactId).unsubscribeToken);
    // logged on the customer's deal as the brand
    expect((await recordMessages(exec, "Deal", a.dealId))[0]).toMatchObject({ channel: "EMAIL", status: "SENT", fromAddress: "sales@hmnl.example.test" });

    // delivery reports only move forward
    const messageA = await unsafeDb.message.findFirstOrThrow({ where: { campaignMemberId: of(a.contactId).id } });
    expect(await applyDeliveryStatus(messageA.providerMessageId!, "DELIVERED")).toBe(true);
    await applyDeliveryStatus(messageA.providerMessageId!, "OPENED");
    await applyDeliveryStatus(messageA.providerMessageId!, "DELIVERED");
    await applyDeliveryStatus(messageA.providerMessageId!, "FAILED", "late bounce");
    expect((await unsafeDb.campaignMember.findUniqueOrThrow({ where: { id: of(a.contactId).id } })).status).toBe("OPENED");
    expect(await applyDeliveryStatus("unknown-id", "DELIVERED")).toBe(false);

    // unsubscribe: this brand only
    await unsafeDb.contactBrandConsent.create({ data: { contactId: b.contactId, brandId: I.brand("SNMNL"), consent: true } });
    expect(await unsubscribeByToken(of(b.contactId).unsubscribeToken)).toEqual({ brandName: expect.any(String) });
    const consents = await unsafeDb.contactBrandConsent.findMany({ where: { contactId: b.contactId } });
    expect(consents.find((x) => x.brandId === I.brand("HMNL"))!.consent).toBe(false);
    expect(consents.find((x) => x.brandId === I.brand("SNMNL"))!.consent).toBe(true);
    expect(await unsubscribeByToken("no-such-token")).toBeNull();

    // ROI: a lead attributed to the campaign is converted and won
    const l = await lead(exec, "HMNL");
    await unsafeDb.lead.update({ where: { id: l.id }, data: { campaignId: c.id } });
    const conv = await convertLead(exec, l.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "From campaign", amount: 5_000_000 } } as never);
    const won = await unsafeDb.pipelineStage.findFirstOrThrow({ where: { type: "WON", pipeline: { brandId: I.brand("HMNL"), isDefault: true } } });
    await unsafeDb.deal.update({ where: { id: conv.dealId }, data: { stageId: won.id } });
    const stats = await campaigns.campaignStats(bm, c.id);
    expect(stats).toMatchObject({ leads: 1, deals: 1, wonDeals: 1, revenue: 5_000_000, budget: 1_000_000, roi: 400 });
    expect(stats.members.UNSUBSCRIBED).toBe(1);
    expect(stats.members.SUPPRESSED).toBeGreaterThanOrEqual(1);
    // a campaign of another brand cannot be attributed
    await expect(unsafeDb.lead.update({ where: { id: (await lead(snmnl, "SNMNL")).id }, data: { campaignId: c.id } })).rejects.toThrow(/another brand/);
    // deals created by the test use createDeal elsewhere – make sure the helper import is exercised
    expect(typeof createDeal).toBe("function");
  });
});
