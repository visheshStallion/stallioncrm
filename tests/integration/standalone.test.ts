import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import * as docs from "@/server/modules/documents/service";
import { getDocument, listDocuments } from "@/server/modules/documents/queries";
import * as email from "@/server/modules/email/service";
import { createLead } from "@/server/modules/leads/service";
import { sandboxOutbox } from "@/server/modules/messaging/providers";
import * as print from "@/server/modules/print/service";
import { runSavedReport } from "@/server/modules/reports/service";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

/**
 * Standalone leads, quotes, sales orders and invoices (prompt 23 §9): minimum fields, free-text lines, link later,
 * brand rules, non-stock vehicle lines, reports – and brand isolation for records without links.
 */
let admin: AccessContext;
let hmnlExec: AccessContext;
let snmnlExec: AccessContext;
let multiExec: AccessContext;
let bmHmnl: AccessContext;
let id: Awaited<ReturnType<typeof ids>>;
let product: { id: string; price: number };
const lagos = () => id.region("Lagos");
const NUMBER = (code: string, t: string) => new RegExp(`^${code}-${t}-\\d{4}-\\d{5}$`);
const minimal = (extra: Record<string, unknown> = {}) => ({ billTo: { name: "Walk-in Customer", phone: "+2348031112233", email: "walkin@example.test" }, lines: [{ description: "Floor mats", qty: 2, unitPrice: 50_000 }], ...extra });
const setRules = (brand: string, rules: Record<string, unknown>) => unsafeDb.brand.update({ where: { id: id.brand(brand) }, data: { documentRules: rules as object } });

beforeAll(async () => {
  process.env.PRINT_PDF_ENGINE = "basic";
  [admin, hmnlExec, snmnlExec, multiExec, bmHmnl] = (await Promise.all(["admin", "exec.hmnl.1", "exec.snmnl.1", "exec.multi.1", "bm.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
  await unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { fromEmail: "sales@hmnl.example", legalEntity: "Hyundai Motors Nigeria Ltd", docPrefix: "HMNL" } });
  await unsafeDb.brand.update({ where: { id: id.brand("SNMNL") }, data: { fromEmail: "sales@snmnl.example", docPrefix: "SNMNL" } });
  await setRules("HMNL", {});
  await setRules("SNMNL", {});
  const entry = await unsafeDb.priceBookEntry.findFirstOrThrow({ where: { priceBook: { brandId: id.brand("HMNL"), active: true }, product: { active: true } }, select: { productId: true, price: true } });
  product = { id: entry.productId, price: Number(entry.price.toString()) };
});

describe("minimum fields", () => {
  it("a lead needs brand, region, a last name or a company, and a mobile or e-mail – nothing else", async () => {
    const company = await createLead(hmnlExec, { company: "Acme Logistics Ltd", mobile: "+2348035551001", brandId: id.brand("HMNL"), regionId: lagos() } as never);
    const row = await unsafeDb.lead.findUniqueOrThrow({ where: { id: company.id } });
    expect(row).toMatchObject({ lastName: null, company: "Acme Logistics Ltd", brandId: id.brand("HMNL"), regionId: lagos(), modelOfInterestId: null, campaignId: null });
    expect(row.territoryId).toBeTruthy();
    await expect(createLead(hmnlExec, { mobile: "+2348035551002", brandId: id.brand("HMNL"), regionId: lagos() } as never)).rejects.toThrow(/last name or a company/);
    await expect(createLead(hmnlExec, { lastName: "Bello", brandId: id.brand("HMNL"), regionId: lagos() } as never)).rejects.toThrow(/Mobile or email/);
    // the database refuses a nameless lead too
    await expect(unsafeDb.lead.update({ where: { id: company.id }, data: { company: null } })).rejects.toThrow(/Lead_name_check/);
  });

  it("a quote, a sales order and an invoice are created with only brand, region, customer name and one line", async () => {
    // brand and region are filled from the user's only brand and region
    const quote = await docs.createDocument(hmnlExec, "quote", minimal());
    const order = await docs.createDocument(hmnlExec, "salesOrder", minimal());
    const invoice = await docs.createDocument(hmnlExec, "invoice", minimal({ issueDate: "2026-10-01" }));
    expect(quote.number).toMatch(NUMBER("HMNL", "QT"));
    expect(order.number).toMatch(NUMBER("HMNL", "SO"));
    expect(invoice.number).toMatch(NUMBER("HMNL", "INV"));
    const q = await getDocument(hmnlExec, "quote", quote.id);
    expect(q).toMatchObject({ dealId: null, accountId: null, contactId: null, sourceDocumentId: null, brandId: id.brand("HMNL"), regionId: lagos(), ownerId: hmnlExec.userId, linkStatus: "Unlinked", customerName: "Walk-in Customer", status: "DRAFT" });
    // 2 × 50,000 + 7.5 % VAT
    expect(q).toMatchObject({ subtotal: 100_000, taxTotal: 7_500, total: 107_500 });
    expect(q.lines[0]).toMatchObject({ productId: null, description: "Floor mats", isStockItem: false });
    expect((await getDocument(hmnlExec, "invoice", invoice.id)).issueDate).toBe("2026-10-01");
    expect(await unsafeDb.auditLog.count({ where: { entity: "Quote", entityId: quote.id, action: "CREATE" } })).toBe(1);

    await expect(docs.createDocument(hmnlExec, "quote", minimal({ billTo: { name: "" } }))).rejects.toThrow(/customer's name/);
    await expect(docs.createDocument(hmnlExec, "quote", minimal({ lines: [] }))).rejects.toThrow(/at least one line/);
    await expect(docs.createDocument(hmnlExec, "quote", minimal({ lines: [{ description: "No price", qty: 1 }] }))).rejects.toThrow(/unit price/);
    // several brands: the brand must be chosen; a brand of somebody else does not exist
    await expect(docs.createDocument(multiExec, "quote", minimal())).rejects.toThrow(/Choose the brand/);
    await expect(docs.createDocument(hmnlExec, "quote", minimal({ brandId: id.brand("SNMNL"), regionId: lagos() }))).rejects.toThrow(/not found/i);
    const sn = await docs.createDocument(multiExec, "invoice", minimal({ brandId: id.brand("SNMNL"), regionId: lagos() }));
    expect(sn.number).toMatch(NUMBER("SNMNL", "INV"));
  });

  it("standalone documents keep brand isolation: another brand gets a 404 and never lists them", async () => {
    const quote = await docs.createDocument(hmnlExec, "quote", minimal({ billTo: { name: "Isolation Test Customer" } }));
    await expect(getDocument(snmnlExec, "quote", quote.id)).rejects.toThrow(/not found/i);
    expect((await listDocuments(snmnlExec, "quote", {}, { q: "Isolation Test Customer", take: 50 })).rows).toEqual([]);
    expect((await listDocuments(hmnlExec, "quote", {}, { q: "Isolation Test Customer", take: 50 })).rows.map((r) => r.id)).toEqual([quote.id]);
    expect(await rawAsUser(snmnlExec, `SELECT id FROM "Quote" WHERE id = '${quote.id}'`)).toEqual([]);
    await expect(docs.linkDocument(snmnlExec, "quote", quote.id, { accountId: null })).rejects.toThrow(/not found/i);
  });
});

describe("lines and approval", () => {
  it("two free-text lines and a product line: the product is priced from the price book, totals and VAT on the server", async () => {
    const q = await docs.createDocument(hmnlExec, "quote", {
      billTo: { name: "Ngozi Eze" },
      lines: [
        { description: "Window tint", qty: 1, unitPrice: 80_000, uom: "set" },
        { description: "Service pack 1 year", qty: 1, unitPrice: 150_000, taxRate: 0, itemCode: "SVC-1Y" },
        { productId: product.id, description: "Vehicle", qty: 1 },
      ],
    });
    const d = await getDocument(hmnlExec, "quote", q.id);
    expect(d.lines.map((l) => [l.description, l.unitPrice, l.uom, l.itemCode, l.isStockItem])).toEqual([
      ["Window tint", 80_000, "set", null, false],
      ["Service pack 1 year", 150_000, null, "SVC-1Y", false],
      ["Vehicle", product.price, null, null, false],
    ]);
    const vat = Math.round((80_000 * 0.075 + product.price * (d.lines[2]!.taxRate / 100)) * 100) / 100;
    expect(d.subtotal).toBe(230_000 + product.price);
    expect(d.taxTotal).toBeCloseTo(vat, 2);
    expect(d.total).toBeCloseTo(230_000 + product.price + vat, 2);
    // a product of another brand is refused
    const foreign = await unsafeDb.product.findFirstOrThrow({ where: { brandId: id.brand("SNMNL") }, select: { id: true } });
    await expect(docs.createDocument(hmnlExec, "quote", { billTo: { name: "X" }, lines: [{ productId: foreign.id, description: "X", qty: 1, unitPrice: 1 }] })).rejects.toThrow(/not found|another brand/i);
  });

  it("a discount on free-text items above the brand's amount threshold needs approval", async () => {
    await setRules("HMNL", { discountAmountApproval: 100_000 });
    try {
      // 2 % – below the percentage threshold (3 %), but 2 % of 10 million is 200,000: above the amount threshold
      const big = await docs.createDocument(hmnlExec, "quote", { billTo: { name: "Fleet buyer" }, lines: [{ description: "Bus conversion", qty: 1, unitPrice: 10_000_000, discountPct: 2 }] });
      const res = await docs.submitQuote(hmnlExec, big.id);
      expect(res.status).toBe("PENDING_APPROVAL");
      expect(res.decision.reasons.join(" ")).toMatch(/amount threshold/);
      // a small one goes through
      const small = await docs.createDocument(hmnlExec, "quote", { billTo: { name: "Small buyer" }, lines: [{ description: "Mats", qty: 1, unitPrice: 100_000, discountPct: 2 }] });
      expect((await docs.submitQuote(hmnlExec, small.id)).status).toBe("APPROVED");
    } finally {
      await setRules("HMNL", {});
    }
  });
});

describe("print and e-mail without an account", () => {
  it("a standalone invoice prints and e-mails with its bill-to snapshot on the brand letterhead", async () => {
    const inv = await docs.createDocument(hmnlExec, "invoice", { billTo: { name: "Chinedu Okafor", company: "Okafor Haulage", phone: "+2348035559999", email: "chinedu@okafor.example", address: "4 Port Road", city: "Apapa", taxId: "TIN-778899" }, lines: [{ description: "Tyres", qty: 4, unitPrice: 90_000 }] });
    const { html } = await print.renderPrintHtml(hmnlExec, { module: "invoices", recordIds: [inv.id], via: "preview" });
    expect(html).toContain('data-letterhead="HMNL"');
    expect(html).toContain("Chinedu Okafor");
    const res = await email.sendEmail(hmnlExec, { parentType: "Invoice", parentId: inv.id, to: ["chinedu@okafor.example"], subject: "Invoice {{invoice.number}} for {{billTo.name}}", doc: { blocks: [{ type: "text", html: "<p>Dear {{contact.firstName}}, attached.</p>" }] }, attachPrint: "default" });
    expect(res.status).toBe("SENT");
    const sent = sandboxOutbox[sandboxOutbox.length - 1]!;
    expect(sent.subject).toMatch(/^Invoice HMNL-INV-\d{4}-\d{5} for Chinedu Okafor$/);
    expect(sent.from.address).toBe("sales@hmnl.example");
    expect(sent.attachments!.some((a) => a.contentType === "application/pdf")).toBe(true);
    // the composer suggests the snapshot's e-mail
    expect((await email.composerData(hmnlExec, "Invoice", inv.id)).suggestions.map((s) => s.email)).toContain("chinedu@okafor.example");
  });
});

describe("link later", () => {
  it("an SNMNL deal cannot be linked to an HMNL quote; a same-brand account can, with an audit entry and an optional new bill-to", async () => {
    const quote = await docs.createDocument(multiExec, "quote", minimal({ brandId: id.brand("HMNL"), regionId: lagos(), billTo: { name: "Link Later Ltd" } }));
    const snDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("SNMNL"), regionId: lagos(), deletedAt: null }, select: { id: true } });
    await expect(docs.linkDocument(multiExec, "quote", quote.id, { dealId: snDeal.id })).rejects.toThrow(/another brand/);
    const hmDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), regionId: lagos(), deletedAt: null, stage: { type: "OPEN" } }, select: { id: true } });
    expect((await docs.linkDocument(multiExec, "quote", quote.id, { dealId: hmDeal.id })).dealId).toBe(hmDeal.id);

    const account = await unsafeDb.account.findFirstOrThrow({ where: { deletedAt: null, phone: { not: null } }, select: { id: true, name: true } });
    const linked = await docs.linkDocument(multiExec, "quote", quote.id, { accountId: account.id, refreshBillTo: true });
    expect(linked).toMatchObject({ accountId: account.id, linkStatus: "Linked" });
    expect(linked.billTo?.name).toBe(account.name);
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "Quote", entityId: quote.id, action: "UPDATE" }, orderBy: { at: "desc" } });
    expect(entry.after).toMatchObject({ accountId: account.id, link: true });
    // unlink again
    expect((await docs.linkDocument(multiExec, "quote", quote.id, { dealId: null })).dealId).toBeNull();
    await expect(docs.linkDocument(multiExec, "quote", quote.id, {})).rejects.toThrow(/Nothing to link/);
  });

  it("an issued invoice can be linked to a deal, but its lines and amounts stay the same; no circular links", async () => {
    const inv = await docs.createDocument(hmnlExec, "invoice", minimal());
    await docs.issueInvoice(hmnlExec, inv.id);
    const before = await getDocument(hmnlExec, "invoice", inv.id);
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), regionId: lagos(), deletedAt: null }, select: { id: true } });
    const after = await docs.linkDocument(hmnlExec, "invoice", inv.id, { dealId: deal.id });
    expect(after).toMatchObject({ dealId: deal.id, total: before.total, status: "ISSUED" });
    expect(after.lines).toEqual(before.lines);
    await expect(docs.linkDocument(hmnlExec, "invoice", inv.id, { sourceDocumentId: inv.id })).rejects.toThrow(/not found|own source/i);
  });

  it("create customer from a document (with duplicate check) and create a deal from a quote", async () => {
    const q = await docs.createDocument(hmnlExec, "quote", { billTo: { name: "Amaka Obi", company: `Obi Transport ${Date.now()}`, phone: "+2348035557711", email: "amaka@obi.example", city: "Lagos" }, lines: [{ productId: product.id, description: "Vehicle", qty: 1 }] });
    const res = await docs.createCustomerFromDocument(hmnlExec, "quote", q.id);
    expect(res.duplicate).toBe(false);
    const doc = await getDocument(hmnlExec, "quote", q.id);
    expect(doc.accountId).toBe(res.accountId);
    expect(doc.contactId).toBe(res.contactId);
    // a second document of the same customer links the existing account
    const q2 = await docs.createDocument(hmnlExec, "quote", { billTo: { name: "Amaka Obi", phone: "+2348035557711" }, lines: [{ description: "Mats", qty: 1, unitPrice: 10_000 }] });
    expect(await docs.createCustomerFromDocument(hmnlExec, "quote", q2.id)).toMatchObject({ duplicate: true, accountId: res.accountId });

    const { dealId } = await docs.createDealFromQuote(hmnlExec, q.id);
    const deal = await unsafeDb.deal.findUniqueOrThrow({ where: { id: dealId }, include: { stage: true } });
    expect(deal).toMatchObject({ brandId: id.brand("HMNL"), regionId: lagos(), accountId: res.accountId, modelId: product.id });
    expect(Number(deal.amount)).toBeCloseTo(doc.total, 2);
    expect((await getDocument(hmnlExec, "quote", q.id)).dealId).toBe(dealId);
  });
});

describe("conversion and brand rules", () => {
  it("an accepted standalone quote converts to an order and to an invoice directly; the snapshot travels along", async () => {
    const q = await docs.createDocument(hmnlExec, "quote", minimal({ billTo: { name: "Convert Me" } }));
    await docs.submitQuote(hmnlExec, q.id);
    await docs.acceptQuote(hmnlExec, q.id);
    const inv = await docs.convertQuoteToInvoice(hmnlExec, q.id);
    const invoice = await getDocument(hmnlExec, "invoice", inv.id);
    expect(invoice).toMatchObject({ sourceDocumentId: q.id, dealId: null, linkStatus: "Linked", customerName: "Convert Me" });
    const so = await docs.convertQuoteToOrder(hmnlExec, q.id);
    expect((await getDocument(hmnlExec, "salesOrder", so.id)).billTo?.name).toBe("Convert Me");
  });

  it("'Require a sales order before an invoice' blocks standalone invoices of that brand only", async () => {
    await setRules("HMNL", { requireOrderBeforeInvoice: true, requireProduct: true });
    try {
      await expect(docs.createDocument(multiExec, "invoice", minimal({ brandId: id.brand("HMNL"), regionId: lagos() }))).rejects.toThrow(/sales orders only|product on every line/);
      await expect(docs.createDocument(multiExec, "invoice", { ...minimal({ brandId: id.brand("HMNL"), regionId: lagos() }), lines: [{ productId: product.id, description: "Vehicle", qty: 1 }] })).rejects.toThrow(/from sales orders only/);
      expect((await docs.createDocument(multiExec, "invoice", minimal({ brandId: id.brand("SNMNL"), regionId: lagos() }))).number).toMatch(NUMBER("SNMNL", "INV"));
      // from an order it still works
      const so = await docs.createDocument(multiExec, "salesOrder", { ...minimal({ brandId: id.brand("HMNL"), regionId: lagos() }), lines: [{ productId: product.id, description: "Vehicle", qty: 1 }] });
      expect((await docs.createDocument(multiExec, "invoice", { ...minimal({ brandId: id.brand("HMNL"), regionId: lagos(), sourceDocumentId: so.id }), lines: [{ productId: product.id, description: "Vehicle", qty: 1 }] })).number).toMatch(NUMBER("HMNL", "INV"));
      const counts = await docs.ruleViolations(admin, id.brand("HMNL"));
      expect(counts.requireOrderBeforeInvoice).toBeGreaterThan(0);
    } finally {
      await setRules("HMNL", {});
    }
  });

  it("a vehicle invoice with a free-text VIN moves no stock and is a non-stock line; with the stock-link rule issuing is blocked", async () => {
    const vin = `FREETEXT${Date.now()}`.slice(0, 17);
    const make = () => docs.createDocument(hmnlExec, "invoice", { billTo: { name: "Vehicle buyer" }, lines: [{ description: "Used SUV", qty: 1, unitPrice: 15_000_000, vin, isStockItem: true }] });
    const inv = await make();
    const movements = await unsafeDb.stockMovement.count();
    await docs.issueInvoice(hmnlExec, inv.id);
    expect(await unsafeDb.stockMovement.count()).toBe(movements);
    expect(await docs.nonStockLines(hmnlExec, await getDocument(hmnlExec, "invoice", inv.id))).toHaveLength(1);
    const report = await runSavedReport(admin, "non-stock-vehicle-lines");
    const number = (await getDocument(hmnlExec, "invoice", inv.id)).number;
    expect(report.result.rows.some((r) => r.includes(number))).toBe(true);

    await setRules("HMNL", { requireStockLinkForVehicleInvoice: true });
    try {
      const blocked = await make();
      await expect(docs.issueInvoice(hmnlExec, blocked.id)).rejects.toThrow(/linked to a stock unit/);
      // a VIN that is a stock unit of the brand is linked
      const unit = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: id.brand("HMNL") }, select: { vin: true } });
      const ok = await docs.createDocument(hmnlExec, "invoice", { billTo: { name: "Stock buyer" }, lines: [{ description: "SUV from stock", qty: 1, unitPrice: 15_000_000, vin: unit.vin, isStockItem: true }] });
      await docs.issueInvoice(hmnlExec, ok.id);
    } finally {
      await setRules("HMNL", {});
    }
  });

  it("the 'Unlinked documents by brand' report groups standalone documents per brand and type", async () => {
    const res = await runSavedReport(admin, "unlinked-documents-by-brand");
    const groups = res.result.rows.map((r) => `${r[0]}|${r[1]}`);
    expect(groups).toEqual(expect.arrayContaining(["HMNL|Quote", "HMNL|Invoice", "HMNL|Sales Order"]));
    // an HMNL exec only sees HMNL groups
    const own = await runSavedReport(hmnlExec, "unlinked-documents-by-brand");
    expect(new Set(own.result.rows.map((r) => r[0]))).toEqual(new Set(["HMNL"]));
    expect((await listDocuments(hmnlExec, "quote", {}, { linked: "Unlinked", take: 500 })).rows.every((r) => r.linkStatus === "Unlinked")).toBe(true);
  });

  it("existing flows are unchanged: a quote from a deal inherits brand, region and customer", async () => {
    const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), ownerId: hmnlExec.userId, stage: { type: "OPEN" }, deletedAt: null }, select: { id: true, regionId: true } });
    const q = await docs.createQuoteFromDeal(hmnlExec, deal.id);
    const d = await getDocument(hmnlExec, "quote", q.id);
    expect(d).toMatchObject({ dealId: deal.id, brandId: id.brand("HMNL"), regionId: deal.regionId, linkStatus: "Linked" });
    expect(d.billTo?.name).toBeTruthy();
    // a document can never be given another brand
    await expect(unsafeDb.quote.update({ where: { id: q.id }, data: { brandId: id.brand("SNMNL") } })).rejects.toThrow(/brand/);
    void bmHmnl;
  });
});
