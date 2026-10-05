import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import * as approvals from "@/server/modules/approvals/service";
import * as tpl from "@/server/modules/doctpl/service";
import { docStarter } from "@/server/modules/doctpl/starters";
import * as docs from "@/server/modules/documents/service";
import * as email from "@/server/modules/email/service";
import { sandboxOutbox } from "@/server/modules/messaging/providers";
import * as print from "@/server/modules/print/service";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

/**
 * Document template builder (prompt 21 §7): letterhead of the record's brand, who may create / publish / use,
 * approval, the send flow with its stored copy, and isolation between brands.
 */
let admin: AccessContext;
let hmnlExec: AccessContext;
let snmnlExec: AccessContext;
let multiExec: AccessContext;
let bmHmnl: AccessContext;
let bmSnmnl: AccessContext;
let ba: AccessContext; // Brand Admin of HMNL
let id: Awaited<ReturnType<typeof ids>>;
let hmnlInvoice: string;
let snmnlInvoice: string;
let hmnlDeal: { id: string; name: string };

const letterheads = (html: string) => [...new Set([...html.matchAll(/data-letterhead="([^"]+)"/g)].map((m) => m[1]))];
const invoiceContent = () => docStarter("tax-invoice")!.content;
const save = (ctx: AccessContext, templateId: string, content: unknown, name = "Template") => tpl.saveTemplate(ctx, templateId, { name, paper: "A4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 18, left: 14 }, content, cssOverrides: "" });

/** An issued invoice of an open deal of the brand: quote → order → invoice, one vehicle at ₦ 30,000,000 + 7.5 % VAT. */
async function invoiceOf(brand: string): Promise<string> {
  const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand(brand), stage: { type: "OPEN" }, deletedAt: null, contactId: { not: null } }, select: { id: true, contactId: true } });
  await unsafeDb.contact.update({ where: { id: deal.contactId! }, data: { email: `customer.${brand.toLowerCase()}@example.test` } });
  const quote = await docs.createQuoteFromDeal(admin, deal.id);
  await docs.saveDocument(admin, "quote", quote.id, { lines: [{ description: "Vehicle", qty: 1, unitPrice: 30_000_000, discountPct: 0, taxRate: 7.5 }] } as never);
  await docs.submitQuote(admin, quote.id);
  await docs.acceptQuote(admin, quote.id);
  const order = await docs.convertQuoteToOrder(admin, quote.id);
  await docs.confirmOrder(admin, order.id);
  const invoice = await docs.convertOrderToInvoice(admin, order.id);
  await docs.issueInvoice(admin, invoice.id);
  return invoice.id;
}

beforeAll(async () => {
  process.env.PRINT_PDF_ENGINE = "basic";
  [admin, hmnlExec, snmnlExec, multiExec, bmHmnl, bmSnmnl, ba] = (await Promise.all(["admin", "exec.hmnl.1", "exec.snmnl.1", "exec.multi.1", "bm.hmnl", "bm.snmnl", "ba.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
  await unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { fromEmail: "sales@hmnl.example", fromName: "Hyundai Sales", legalEntity: "Hyundai Motors Nigeria Ltd", bankDetails: "Demo Bank · 0000000000" } });
  await unsafeDb.brand.update({ where: { id: id.brand("SNMNL") }, data: { fromEmail: "sales@snmnl.example", legalEntity: "Stallion Nissan Motors Nigeria Ltd" } });
  hmnlInvoice = await invoiceOf("HMNL");
  snmnlInvoice = await invoiceOf("SNMNL");
  hmnlDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, region: { name: "Lagos" } }, select: { id: true, name: true } });
});

describe("letterhead and brands", () => {
  let hmnlTemplate: string;
  let groupTemplate: string;

  it("an HMNL invoice template previews and prints on the HMNL letterhead, with totals and the amount in words", async () => {
    const t = await tpl.createTemplate(ba, { name: "HMNL Tax Invoice", module: "invoices", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND", starter: "tax-invoice" });
    hmnlTemplate = t.id;
    const preview = await tpl.previewTemplate(ba, { module: "invoices", brandId: id.brand("HMNL"), paper: "A4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 18, left: 14 }, content: invoiceContent(), cssOverrides: "font-family: Georgia; position: fixed", recordId: hmnlInvoice });
    expect(letterheads(preview.html)).toEqual(["HMNL"]);
    expect(preview.html).toContain("Hyundai Motors Nigeria Ltd");
    expect(preview.html).toContain("TAX INVOICE");
    expect(preview.html).toContain('.sheet { font-family: "Georgia", Arial, sans-serif }'); // only the allow-listed declaration survives
    expect(preview.lint.droppedCss).toEqual(["position"]);
    expect(preview.lint.errors).toEqual([]);

    // not usable before it is published
    await expect(print.renderPrintHtml(ba, { module: "invoices", recordIds: [hmnlInvoice], templateId: `doc:${t.id}`, via: "preview" })).rejects.toThrow(/not found/i);
    expect((await tpl.publishTemplate(ba, t.id)).version).toBe(1);
    const { html } = await print.renderPrintHtml(hmnlExec, { module: "invoices", recordIds: [hmnlInvoice], templateId: `doc:${t.id}`, via: "preview" });
    expect(letterheads(html)).toEqual(["HMNL"]);
    // amounts come from the server-computed document: 30,000,000 + 7.5 % VAT
    expect(html).toContain("32,250,000.00");
    expect(html).toContain("Thirty-Two Million, Two Hundred and Fifty Thousand Naira Only");
    expect(html).toContain("Demo Bank · 0000000000"); // payment details = the brand's bank account
    expect(html).toMatch(/<thead><tr><td data-region="header">/); // letterhead in the repeating page header
    expect(html).toContain("Balance due:"); // conditional section: the balance is above zero
  });

  it("a group template renders the RECORD's brand: SNMNL letterhead for an SNMNL invoice; the HMNL template is not offered there", async () => {
    const g = await tpl.createTemplate(admin, { name: "Group Tax Invoice", module: "invoices", brandId: null, visibility: "GROUP", starter: "tax-invoice" });
    groupTemplate = g.id;
    await tpl.publishTemplate(admin, g.id);
    const snmnl = await print.renderPrintHtml(multiExec, { module: "invoices", recordIds: [snmnlInvoice], templateId: `doc:${g.id}`, via: "preview" });
    expect(letterheads(snmnl.html)).toEqual(["SNMNL"]);
    expect(snmnl.html).toContain("Stallion Nissan Motors Nigeria Ltd");
    expect(snmnl.html).not.toContain("Hyundai Motors Nigeria Ltd");
    const hmnl = await print.renderPrintHtml(multiExec, { module: "invoices", recordIds: [hmnlInvoice], templateId: `doc:${g.id}`, via: "preview" });
    expect(letterheads(hmnl.html)).toEqual(["HMNL"]);

    // an HMNL template cannot be used for an SNMNL record – not even by someone in both brands
    await expect(print.renderPrintHtml(multiExec, { module: "invoices", recordIds: [snmnlInvoice], templateId: `doc:${hmnlTemplate}`, via: "preview" })).rejects.toThrow(/not found/i);
    const record = await print.loadPrintRecord(multiExec, "invoices", snmnlInvoice);
    expect((await print.templateChoices(multiExec, record)).map((c) => c.name)).toEqual(expect.arrayContaining(["Group Tax Invoice"]));
    expect((await print.templateChoices(multiExec, record)).map((c) => c.name)).not.toContain("HMNL Tax Invoice");
    // a user without SNMNL: the record is a 404 with any template, and SNMNL templates are not listed
    await expect(print.renderPrintHtml(hmnlExec, { module: "invoices", recordIds: [snmnlInvoice], templateId: `doc:${g.id}`, via: "preview" })).rejects.toThrow(/not found/i);
    const sn = await tpl.createTemplate(admin, { name: "SNMNL Invoice", module: "invoices", brandId: id.brand("SNMNL"), visibility: "SHARED_BRAND" });
    await tpl.publishTemplate(admin, sn.id);
    expect((await tpl.listTemplates(hmnlExec)).map((t) => t.name)).not.toContain("SNMNL Invoice");
    await expect(tpl.getTemplate(hmnlExec, sn.id)).rejects.toThrow(/not found/i);
    await expect(tpl.getTemplate(ba, sn.id)).rejects.toThrow(/not found/i);
    await expect(save(ba, sn.id, invoiceContent())).rejects.toThrow(/not found/i);
    await expect(tpl.previewTemplate(hmnlExec, { module: "invoices", brandId: id.brand("SNMNL"), paper: "A4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 18, left: 14 }, content: invoiceContent() })).rejects.toThrow(/not found/i);
  });

  it("the default template of the brand is used when none is chosen; user sessions cannot read the tables directly", async () => {
    await expect(tpl.setDefault(bmHmnl, hmnlTemplate, true)).rejects.toThrow(/Brand Admin or an administrator/);
    await tpl.setDefault(ba, hmnlTemplate, true);
    await tpl.setDefault(admin, groupTemplate, true);
    const hmnl = await print.renderPrintHtml(hmnlExec, { module: "invoices", recordIds: [hmnlInvoice], via: "preview" });
    expect(hmnl.prepared.template.name).toBe("HMNL Tax Invoice"); // the brand's own default wins over the group's
    const snmnl = await print.renderPrintHtml(snmnlExec, { module: "invoices", recordIds: [snmnlInvoice], via: "preview" });
    expect(snmnl.prepared.template.name).toBe("Group Tax Invoice");
    await expect(rawAsUser(hmnlExec, `SELECT id FROM "DocumentTemplate"`)).rejects.toThrow(/permission denied/);
    await expect(rawAsUser(hmnlExec, `SELECT id FROM "GeneratedDocument"`)).rejects.toThrow(/permission denied/);
  });
});

describe("who may create, publish and use", () => {
  it("a sales exec has personal templates only – not for invoices, not published for others, never for a financial document", async () => {
    await expect(tpl.createTemplate(hmnlExec, { name: "My invoice", module: "invoices", brandId: id.brand("HMNL"), visibility: "PERSONAL" })).rejects.toThrow(/official documents/);
    await expect(tpl.createTemplate(hmnlExec, { name: "Shared", module: "deals", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" })).rejects.toThrow(/brand's manager/);
    await expect(tpl.createTemplate(hmnlExec, { name: "Group", module: "deals", brandId: null, visibility: "GROUP" })).rejects.toThrow(/administrators/);
    await expect(tpl.createTemplate(hmnlExec, { name: "Other brand", module: "deals", brandId: id.brand("SNMNL"), visibility: "PERSONAL" })).rejects.toThrow(/not found/i);

    const mine = await tpl.createTemplate(hmnlExec, { name: "My offer letter", module: "deals", brandId: null, visibility: "PERSONAL", starter: "deal-offer-letter" });
    await tpl.publishTemplate(hmnlExec, mine.id); // the author publishes their own personal template
    const { html } = await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], templateId: `doc:${mine.id}`, via: "preview" });
    expect(letterheads(html)).toEqual(["HMNL"]); // "all my brands": the record's brand
    expect(html).toContain(`Offer: ${hmnlDeal.name}`);
    // nobody else sees or uses it
    expect((await tpl.listTemplates(bmHmnl)).map((t) => t.name)).not.toContain("My offer letter");
    await expect(tpl.getTemplate(bmHmnl, mine.id)).rejects.toThrow(/not found/i);
    await expect(print.renderPrintHtml(bmHmnl, { module: "deals", recordIds: [hmnlDeal.id], templateId: `doc:${mine.id}`, via: "preview" })).rejects.toThrow(/not found/i);

    // a personal template can never produce an invoice, even if its row is made to say so
    await unsafeDb.documentTemplate.update({ where: { id: mine.id }, data: { module: "invoices" } });
    await expect(print.renderPrintPdf(hmnlExec, { module: "invoices", recordIds: [hmnlInvoice], templateId: `doc:${mine.id}`, via: "email" })).rejects.toThrow(/not found/i);
    await unsafeDb.documentTemplate.update({ where: { id: mine.id }, data: { module: "deals" } });
    // and a shared template of the brand is not publishable by the exec
    const shared = await tpl.createTemplate(bmHmnl, { name: "Exec cannot publish", module: "deals", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" });
    await expect(tpl.publishTemplate(hmnlExec, shared.id)).rejects.toThrow(/not found/i); // an unpublished shared draft is not even visible
    await expect(save(hmnlExec, shared.id, invoiceContent())).rejects.toThrow(/not found/i);
  });

  it("a brand manager submits a shared template; the Brand Admin approves it through the approval engine", async () => {
    const t = await tpl.createTemplate(bmHmnl, { name: "HMNL Sales Order", module: "salesOrders", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND", starter: "sales-order" });
    await expect(tpl.publishTemplate(bmHmnl, t.id)).rejects.toThrow(/submit it for approval/);
    expect((await tpl.getTemplate(bmHmnl, t.id)).needsApproval).toBe(true);
    expect((await tpl.submitTemplate(bmHmnl, t.id)).status).toBe("PENDING");
    expect((await tpl.getTemplate(bmHmnl, t.id)).status).toBe("PENDING_APPROVAL");
    await expect(save(bmHmnl, t.id, docStarter("sales-order")!.content)).rejects.toThrow(/waiting for approval/);

    const task = (await approvals.myApprovalTasks(ba)).find((x) => x.entityId === t.id)!;
    expect(task).toMatchObject({ kind: "DOCUMENT_TEMPLATE", entity: "DocumentTemplate" });
    expect((await approvals.myApprovalTasks(bmSnmnl)).some((x) => x.entityId === t.id)).toBe(false);
    await approvals.decide(ba, task.requestId, true, "Looks right");
    const approved = await tpl.getTemplate(bmHmnl, t.id);
    expect(approved).toMatchObject({ status: "PUBLISHED", version: 1, hasPublished: true, dirty: false, approvedBy: ba.user.name });

    // a change after publication: documents keep the published version until the change is approved; a rejection keeps it too
    const changed = { ...docStarter("sales-order")!.content, header: "<p>CHANGED HEADER</p>" };
    await save(bmHmnl, t.id, changed, "HMNL Sales Order");
    expect((await tpl.getTemplate(bmHmnl, t.id)).dirty).toBe(true);
    await tpl.submitTemplate(bmHmnl, t.id);
    const second = (await approvals.myApprovalTasks(ba)).find((x) => x.entityId === t.id)!;
    await approvals.decide(ba, second.requestId, false, "Not this header");
    expect(await tpl.getTemplate(bmHmnl, t.id)).toMatchObject({ status: "PUBLISHED", version: 1, dirty: true });
    expect(JSON.stringify((await unsafeDb.documentTemplate.findUniqueOrThrow({ where: { id: t.id } })).published)).not.toContain("CHANGED HEADER");
  });

  it("a Brand Admin publishes for the own brand only; group templates are for administrators", async () => {
    const t = await tpl.createTemplate(ba, { name: "HMNL Quotation", module: "quotes", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND", starter: "quotation" });
    expect((await tpl.publishTemplate(ba, t.id)).version).toBe(1);
    await expect(tpl.publishTemplate(ba, t.id)).rejects.toThrow(/no changes/);
    await expect(tpl.createTemplate(ba, { name: "SNMNL by HMNL admin", module: "quotes", brandId: id.brand("SNMNL"), visibility: "SHARED_BRAND" })).rejects.toThrow(/not found/i);
    await expect(tpl.createTemplate(ba, { name: "Group by brand admin", module: "quotes", brandId: null, visibility: "GROUP" })).rejects.toThrow(/administrators/);
    const group = (await tpl.listTemplates(ba)).find((x) => x.name === "Group Tax Invoice")!;
    expect(group).toMatchObject({ editable: false, publishable: false });
    await expect(save(ba, group.id, invoiceContent())).rejects.toThrow(/cannot change/);

    // versions: publish again, restore the first, history is kept
    await save(ba, t.id, { ...docStarter("quotation")!.content, header: "<p>SECOND</p>" }, "HMNL Quotation");
    expect((await tpl.publishTemplate(ba, t.id, "new header")).version).toBe(2);
    await tpl.restoreVersion(ba, t.id, 1);
    const restored = await tpl.getTemplate(ba, t.id);
    expect(restored.content.header).toBe("");
    expect(restored).toMatchObject({ version: 2, dirty: true });
    expect(restored.versions.map((v) => [v.version, v.note])).toEqual([[2, "new header"], [1, null]]);
    const audits = await unsafeDb.auditLog.findMany({ where: { entity: "DocumentTemplate", entityId: t.id } });
    expect(audits.length).toBeGreaterThanOrEqual(5); // create, save, publish ×2, restore
  });

  it("unsafe content is removed or refused", async () => {
    const t = await tpl.createTemplate(ba, { name: "Sanitised", module: "deals", brandId: id.brand("HMNL"), visibility: "SHARED_BRAND" });
    const content = { letterhead: { show: true, logo: "center", details: "below" }, header: '<p onclick="x()">Header</p><script>alert(1)</script>', footer: '<p>Footer</p><iframe src="https://evil.example"></iframe>', body: [{ type: "rich", html: '<p>Hello {{deal.name}}</p><img src="https://evil.example/x.png" onerror="x()" alt="x"><form><input></form><a href="javascript:alert(1)">x</a>' }] };
    await save(ba, t.id, content, "Sanitised");
    const stored = JSON.stringify((await tpl.getTemplate(ba, t.id)).content);
    expect(stored).not.toMatch(/<script|onclick|onerror|<iframe|<form|javascript:/);
    expect(stored).toContain("Hello {{deal.name}}");
    await expect(save(ba, t.id, { ...content, body: [{ type: "rich", html: "<p>{{deal name}}</p>" }] })).rejects.toThrow(/cannot be read/);
    await expect(save(ba, t.id, { ...content, body: [{ type: "conditional", field: "constructor.prototype.x", op: "eq", value: "1", html: "<p>x</p>" }] })).rejects.toThrow();
    // merge fields resolve from the record at hand only: another brand's values are not reachable through a template
    await tpl.publishTemplate(ba, t.id);
    const { html } = await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], templateId: `doc:${t.id}`, via: "preview" });
    expect(html).toContain(`Hello ${hmnlDeal.name.replace(/&/g, "&amp;")}`);
    expect(html).toContain("lh-center");
    const snDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("SNMNL") }, select: { id: true } });
    await expect(print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [snDeal.id], templateId: `doc:${t.id}`, via: "preview" })).rejects.toThrow(/not found/i);
    await expect(print.renderPrintHtml(multiExec, { module: "deals", recordIds: [snDeal.id], templateId: `doc:${t.id}`, via: "preview" })).rejects.toThrow(/not found/i); // HMNL template, SNMNL record
  });
});

describe("send, stored copy, re-send", () => {
  it("sending an invoice attaches the PDF, stores the copy with its hash, logs the activity and marks the invoice sent", async () => {
    const template = (await tpl.listTemplates(hmnlExec, { module: "invoices" })).find((t) => t.name === "HMNL Tax Invoice")!;
    const data = await email.composerData(hmnlExec, "Invoice", hmnlInvoice);
    expect(data.docTemplates.find((t) => t.id === `doc:${template.id}`)).toMatchObject({ isDefault: true });
    expect(data.docTemplates.map((t) => t.name)).not.toContain("SNMNL Invoice");
    const before = (await unsafeDb.documentTemplate.findUniqueOrThrow({ where: { id: template.id } })).usageCount;

    const res = await email.sendEmail(hmnlExec, { parentType: "Invoice", parentId: hmnlInvoice, to: ["customer.hmnl@example.test"], subject: "Your invoice {{invoice.number}}", doc: { blocks: [{ type: "text", html: "<p>Please find your invoice attached.</p>" }] }, attachPrint: `doc:${template.id}` });
    expect(res.status).toBe("SENT");
    const sent = sandboxOutbox[sandboxOutbox.length - 1]!;
    const pdf = sent.attachments!.find((a) => a.contentType === "application/pdf")!;
    expect(Buffer.from(pdf.content.slice(0, 5)).toString()).toBe("%PDF-");
    expect(sent.from).toMatchObject({ address: "sales@hmnl.example" });

    const copies = await tpl.generatedFor(hmnlExec, "invoices", hmnlInvoice);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ templateName: "HMNL Tax Invoice", templateVersion: 1, sentVia: "EMAIL", generatedBy: hmnlExec.user.name });
    expect(copies[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    const row = await unsafeDb.generatedDocument.findUniqueOrThrow({ where: { id: copies[0]!.id } });
    expect(row).toMatchObject({ brandId: id.brand("HMNL"), emailActivityId: res.activityId, templateId: template.id });
    expect(row.fileKey.startsWith(`generated/${id.brand("HMNL")}/`)).toBe(true);
    const file = await tpl.generatedFile(hmnlExec, row.id);
    expect(Buffer.from(file.bytes).equals(Buffer.from(pdf.content))).toBe(true); // the exact copy that was sent

    expect((await unsafeDb.invoice.findUniqueOrThrow({ where: { id: hmnlInvoice } })).sentAt).toBeInstanceOf(Date);
    expect(await unsafeDb.activity.findUniqueOrThrow({ where: { id: res.activityId } })).toMatchObject({ parentType: "Invoice", parentId: hmnlInvoice, brandId: id.brand("HMNL") });
    expect((await unsafeDb.documentTemplate.findUniqueOrThrow({ where: { id: template.id } })).usageCount).toBe(before + 1);
    expect(await unsafeDb.auditLog.count({ where: { entity: "GeneratedDocument", entityId: row.id } })).toBeGreaterThanOrEqual(1);

    // the copy is immutable and belongs to its record: other brands get a 404, changes are refused by the database
    await expect(tpl.generatedFor(snmnlExec, "invoices", hmnlInvoice)).rejects.toThrow(/not found/i);
    await expect(tpl.generatedFile(snmnlExec, row.id)).rejects.toThrow(/not found/i);
    await expect(unsafeDb.generatedDocument.update({ where: { id: row.id }, data: { hash: "0".repeat(64) } })).rejects.toThrow(/cannot be changed/);
  });

  it("re-send uses the stored copy; a new version of the template does not change earlier copies", async () => {
    const copy = (await tpl.generatedFor(hmnlExec, "invoices", hmnlInvoice))[0]!;
    const template = (await tpl.listTemplates(ba, { module: "invoices" })).find((t) => t.name === "HMNL Tax Invoice")!;
    await save(ba, template.id, { ...invoiceContent(), header: "<p>VERSION TWO</p>" }, "HMNL Tax Invoice");
    await tpl.publishTemplate(ba, template.id);

    const res = await email.sendEmail(hmnlExec, { parentType: "Invoice", parentId: hmnlInvoice, to: ["customer.hmnl@example.test"], subject: "Invoice again", doc: { blocks: [{ type: "text", html: "<p>As requested.</p>" }] }, attachGenerated: copy.id });
    expect(res.status).toBe("SENT");
    const again = sandboxOutbox[sandboxOutbox.length - 1]!.attachments!.find((a) => a.contentType === "application/pdf")!;
    const original = await tpl.generatedFile(hmnlExec, copy.id);
    expect(Buffer.from(again.content).equals(Buffer.from(original.bytes))).toBe(true);
    expect(await tpl.generatedFor(hmnlExec, "invoices", hmnlInvoice)).toHaveLength(1); // nothing new was generated
    expect((await tpl.generatedFor(hmnlExec, "invoices", hmnlInvoice))[0]!.templateVersion).toBe(1);

    // "regenerate with current data" makes a second copy with version 2
    await email.sendEmail(hmnlExec, { parentType: "Invoice", parentId: hmnlInvoice, to: ["customer.hmnl@example.test"], subject: "Invoice, current", doc: { blocks: [{ type: "text", html: "<p>Current.</p>" }] }, attachPrint: `doc:${template.id}` });
    expect((await tpl.generatedFor(hmnlExec, "invoices", hmnlInvoice)).map((g) => g.templateVersion)).toEqual([2, 1]);
    // a copy of another record cannot be attached
    const other = await email.sendEmail(multiExec, { parentType: "Invoice", parentId: snmnlInvoice, to: ["customer.snmnl@example.test"], subject: "SNMNL", doc: { blocks: [{ type: "text", html: "<p>x</p>" }] }, attachGenerated: copy.id }).catch((e: Error) => e.message);
    expect(other).toMatch(/not found/i);
    // a template with generated documents cannot be deleted, only archived – and then it is no longer offered
    await expect(tpl.deleteTemplate(ba, template.id)).rejects.toThrow(/archive it instead/);
    await tpl.archiveTemplate(ba, template.id, true);
    await expect(print.renderPrintHtml(hmnlExec, { module: "invoices", recordIds: [hmnlInvoice], templateId: `doc:${template.id}`, via: "preview" })).rejects.toThrow(/not found/i);
    await tpl.archiveTemplate(ba, template.id, false);
  });

  it("an approved quote becomes Sent when it is e-mailed with its document", async () => {
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), stage: { type: "OPEN" }, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const quote = await docs.createQuoteFromDeal(admin, deal.id);
    await docs.saveDocument(admin, "quote", quote.id, { lines: [{ description: "Vehicle", qty: 1, unitPrice: 10_000_000, discountPct: 0, taxRate: 7.5 }] } as never);
    await docs.submitQuote(admin, quote.id);
    expect((await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("APPROVED");
    await email.sendEmail(admin, { parentType: "Quote", parentId: quote.id, to: ["customer@example.test"], subject: "Your quotation", doc: { blocks: [{ type: "text", html: "<p>Attached.</p>" }] }, attachPrint: "default" });
    expect((await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
    // every e-mailed PDF is kept, also one made with a built-in layout or the brand's default template
    expect((await tpl.generatedFor(admin, "quotes", quote.id)).map((g) => g.sentVia)).toEqual(["EMAIL"]);
  });
});

describe("bulk send and automation", () => {
  it("bulk send needs the mass e-mail permission, only takes ids the user can open, and sends one e-mail per customer", async () => {
    const bulk = await import("@/server/modules/doctpl/bulk");
    await expect(bulk.requestBulkSend(hmnlExec, { module: "invoices", ids: [hmnlInvoice], documentTemplate: "default" })).rejects.toThrow(/mass e-mail permission/);
    await expect(bulk.requestBulkSend(bmHmnl, { module: "invoices", ids: [hmnlInvoice, snmnlInvoice], documentTemplate: "default" })).rejects.toThrow(/not found/i);
    await expect(bulk.requestBulkSend(admin, { module: "leads", ids: ["x"], documentTemplate: "default" })).rejects.toThrow(/cannot be sent as documents/);

    const before = sandboxOutbox.length;
    const job = await bulk.requestBulkSend(admin, { module: "invoices", ids: [hmnlInvoice, snmnlInvoice], documentTemplate: "default" });
    expect(await bulk.runBulkSend({ payload: { exportId: job.jobId, userId: admin.userId } })).toEqual({ records: 2, sent: 2 });
    const sent = sandboxOutbox.slice(before);
    // each document from its own brand's sender, to its own customer, with its PDF
    expect(sent.map((m) => [m.from.address, m.to]).sort()).toEqual([["sales@hmnl.example", "customer.hmnl@example.test"], ["sales@snmnl.example", "customer.snmnl@example.test"]]);
    expect(sent.every((m) => m.attachments?.some((a) => a.contentType === "application/pdf"))).toBe(true);
    const done = await unsafeDb.exportJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(done).toMatchObject({ status: "DONE", rowCount: 2, format: "csv" });
    const { storage } = await import("@/server/storage");
    const report = Buffer.from(await storage().get(done.storageKey!)).toString("utf8");
    expect(report.match(/,Sent,/g)).toHaveLength(2);
    expect(await bulk.runBulkSend({ payload: { exportId: job.jobId, userId: admin.userId } })).toHaveProperty("skipped"); // never twice
    expect((await tpl.generatedFor(admin, "invoices", snmnlInvoice)).map((g) => g.templateName)).toEqual(["Group Tax Invoice"]);

    // an HMNL template for a mixed selection: the SNMNL invoice is reported, not sent with the wrong brand's template
    const hmnl = (await tpl.listTemplates(admin, { module: "invoices" })).find((t) => t.name === "HMNL Tax Invoice")!;
    const mixed = await bulk.requestBulkSend(admin, { module: "invoices", ids: [hmnlInvoice, snmnlInvoice], documentTemplate: `doc:${hmnl.id}` });
    expect(await bulk.runBulkSend({ payload: { exportId: mixed.jobId, userId: admin.userId } })).toEqual({ records: 2, sent: 1 });
  });

  it("the workflow action sends the document as the record's owner", async () => {
    const bulk = await import("@/server/modules/doctpl/bulk");
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, stage: { type: "OPEN" }, deletedAt: null, contactId: { not: null } }, select: { id: true, contactId: true } });
    await unsafeDb.contact.update({ where: { id: deal.contactId! }, data: { email: "owner.customer@example.test" } });
    const quote = await docs.createQuoteFromDeal(hmnlExec, deal.id);
    await docs.saveDocument(hmnlExec, "quote", quote.id, { lines: [{ description: "Vehicle", qty: 1, unitPrice: 12_000_000, discountPct: 0, taxRate: 7.5 }] } as never);
    await docs.submitQuote(hmnlExec, quote.id);
    const res = await bulk.runDocumentSend({ payload: { module: "quotes", recordId: quote.id, userId: hmnlExec.userId, documentTemplate: "default", emailTemplateId: null } });
    expect(res).toMatchObject({ to: "owner.customer@example.test" });
    expect(sandboxOutbox[sandboxOutbox.length - 1]!.from.address).toBe("sales@hmnl.example");
    expect((await unsafeDb.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
    // as someone who cannot open the record nothing is sent
    expect(await bulk.runDocumentSend({ payload: { module: "quotes", recordId: quote.id, userId: snmnlExec.userId, documentTemplate: "default", emailTemplateId: null } })).toHaveProperty("notSent");
    // the action is part of the workflow rule schema
    const { actionSchema } = await import("@/server/modules/workflow/schema");
    expect(actionSchema.parse({ type: "SEND_DOCUMENT" })).toEqual({ type: "SEND_DOCUMENT", documentTemplate: "default" });
  });
});
