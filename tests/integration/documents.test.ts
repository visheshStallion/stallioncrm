import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { reserveVin } from "@/server/modules/catalogue/service";
import { getDeal } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import { documentPdfModel, renderDocumentPdf } from "@/server/modules/documents/pdf";
import { getDocument, listDocuments, pendingApproval } from "@/server/modules/documents/queries";
import * as svc from "@/server/modules/documents/service";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let exec: AccessContext; // HMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let snmnl: AccessContext; // SNMNL Lagos exec
let model: { id: string; listPrice: unknown };
const year = new Date().getUTCFullYear();

beforeAll(async () => {
  I = await ids();
  [exec, bm, snmnl] = await Promise.all([ctxFor("exec.hmnl.1"), ctxFor("bm.hmnl"), ctxFor("exec.snmnl.1")]);
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, orderBy: { code: "asc" } });
  await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { legalEntity: "Hypothetical Motors Nigeria Ltd", address: "1 Example Way, Lagos", bankDetails: "Example Bank 0000000000", erpCompanyCode: "ERP-HMNL" } });
  await unsafeDb.brand.update({ where: { id: I.brand("SNMNL") }, data: { legalEntity: "Sample Nippon Motors Nigeria Ltd" } });
});

const newDeal = (ctx: AccessContext, brand = "HMNL", over: Record<string, unknown> = {}) =>
  createDeal(ctx, { name: `Doc deal ${Math.random().toString(36).slice(2, 8)}`, brandId: I.brand(brand), regionId: I.region("Lagos"), ...(brand === "HMNL" ? { modelId: model.id } : {}), ...over } as never);

async function newQuote(ctx: AccessContext = exec) {
  const deal = await newDeal(ctx);
  const quote = await svc.createQuoteFromDeal(ctx, deal.id);
  return { dealId: deal.id, quoteId: quote.id };
}
const lineOf = (over: Record<string, unknown> = {}) => ({ productId: model.id, description: "HMNL vehicle", qty: 1, unitPrice: 40_000_000, discountPct: 0, taxRate: 7.5, ...over });

describe("numbering", () => {
  it("is unique and sequential per brand under concurrent creation, in the documented format", async () => {
    const deals = await Promise.all(Array.from({ length: 8 }, () => newDeal(exec)));
    const before = await unsafeDb.quote.count({ where: { brandId: I.brand("HMNL") } });
    const quotes = await Promise.all(deals.map((d) => svc.createQuoteFromDeal(exec, d.id)));
    const numbers = (await unsafeDb.quote.findMany({ where: { id: { in: quotes.map((q) => q.id) } }, select: { number: true } })).map((q) => q.number).sort();
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `HMNL-QT-${year}-${String(before + i + 1).padStart(5, "0")}`));
    // another brand has its own sequence
    const otherDeal = await newDeal(snmnl, "SNMNL");
    const other = await svc.createQuoteFromDeal(snmnl, otherDeal.id);
    const snmnlCount = await unsafeDb.quote.count({ where: { brandId: I.brand("SNMNL") } });
    expect((await getDocument(snmnl, "quote", other.id)).number).toBe(`SNMNL-QT-${year}-${String(snmnlCount).padStart(5, "0")}`);
    // user sessions cannot touch the counter; numbers cannot be changed
    await expect(rawAsUser(exec, `UPDATE "DocumentCounter" SET "last" = 0`)).rejects.toThrow(/permission denied/);
    await expect(unsafeDb.quote.update({ where: { id: quotes[0]!.id }, data: { number: "X-1" } })).rejects.toThrow(/cannot be changed/);
  });
});

describe("brand isolation and inheritance", () => {
  it("an HMNL exec cannot open, list, print or change an SNMNL quote (404)", async () => {
    const d = await newDeal(snmnl, "SNMNL");
    const q = await svc.createQuoteFromDeal(snmnl, d.id);
    await expect(getDocument(exec, "quote", q.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentPdfModel(exec, "quote", q.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.saveDocument(exec, "quote", q.id, { lines: [] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.submitQuote(exec, q.id)).rejects.toBeInstanceOf(NotFoundError);
    const { rows } = await listDocuments(exec, "quote", {}, { take: 500 });
    expect(rows.every((r) => r.brandId === I.brand("HMNL"))).toBe(true);
    // lines of hidden documents are invisible to raw SQL too
    const lines = await rawAsUser<{ quoteId: string }>(exec, `SELECT "quoteId" FROM "DocumentLine" WHERE "quoteId" = '${q.id}'`);
    expect(lines).toEqual([]);
  });

  it("brand and region are inherited from the deal and cannot diverge", async () => {
    const { dealId, quoteId } = await newQuote();
    const q = await getDocument(exec, "quote", quoteId);
    const deal = await getDeal(exec, dealId);
    expect([q.brandId, q.regionId]).toEqual([deal.brandId, deal.regionId]);
    await expect(unsafeDb.quote.update({ where: { id: quoteId }, data: { brandId: I.brand("SNMNL") } })).rejects.toThrow(/inherits brand and region/);
    await expect(unsafeDb.quote.update({ where: { id: quoteId }, data: { regionId: I.region("Abuja") } })).rejects.toThrow(/inherits brand and region/);
  });

  it("a line with another brand's product fails server-side (service and DB trigger)", async () => {
    const { quoteId } = await newQuote();
    const foreign = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ productId: foreign.id })] as never })).rejects.toThrow(/record's brand/);
    await expect(
      unsafeDb.documentLine.create({ data: { quoteId, position: 9, productId: foreign.id, description: "x", qty: 1, unitPrice: 1, lineTotal: 1 } }),
    ).rejects.toThrow(/another brand/);
  });
});

describe("totals and approval", () => {
  it("a new quote takes the model, quantity and price book price from the deal; totals are computed server-side", async () => {
    const { quoteId } = await newQuote();
    const q = await getDocument(exec, "quote", quoteId);
    const price = Number(String(model.listPrice));
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ productId: model.id, qty: 1, unitPrice: price, taxRate: 7.5 });
    expect(q.total).toBe(Math.round(price * 1.075 * 100) / 100);
    const saved = await svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ qty: 2, discountPct: 1 })] as never, headerDiscountPct: 1 });
    expect(saved.subtotal).toBe(80_000_000);
    expect((await getDocument(exec, "quote", quoteId)).total).toBe(saved.total);
  });

  it("discount within the threshold → Approved directly", async () => {
    const { quoteId } = await newQuote();
    await svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ discountPct: 3 })] as never });
    expect((await svc.submitQuote(exec, quoteId)).status).toBe("APPROVED");
  });

  it("5 % on HMNL (threshold 3 %) → Pending Approval routed to the HMNL Brand Manager; send / accept blocked until approved", async () => {
    const { quoteId } = await newQuote();
    await svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ discountPct: 5 })] as never });
    const res = await svc.submitQuote(exec, quoteId);
    expect(res.status).toBe("PENDING_APPROVAL");
    expect(res.approverId).toBe(await userId("bm.hmnl"));
    const pending = await pendingApproval(exec, "Quote", quoteId);
    expect(pending).toMatchObject({ level: 1, approverId: bm.userId });
    expect(pending!.reason).toMatch(/above/);

    await expect(svc.markQuoteSent(exec, quoteId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.acceptQuote(exec, quoteId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.saveDocument(exec, "quote", quoteId, { lines: [] })).rejects.toThrow(/draft/);
    // the requester cannot approve their own request; another brand's manager cannot even see it
    await expect(svc.decideApproval(exec, pending!.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.decideApproval(await ctxFor("bm.snmnl"), pending!.id, true)).rejects.toBeInstanceOf(NotFoundError);

    await svc.decideApproval(bm, pending!.id, true, "OK for fleet customer");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("APPROVED");
    await svc.markQuoteSent(exec, quoteId);
    await svc.acceptQuote(exec, quoteId);
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("ACCEPTED");
  });

  it("above 7 % → Head of Sales; a rejected approval returns the quote to draft; above the price book maximum also needs approval", async () => {
    const { quoteId } = await newQuote();
    await svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ discountPct: 8 })] as never });
    const res = await svc.submitQuote(exec, quoteId);
    // two steps (prompt 08): the Brand Manager first, then the Head of Sales
    expect(res).toMatchObject({ status: "PENDING_APPROVAL", approverId: await userId("bm.hmnl") });
    const pending = await pendingApproval(exec, "Quote", quoteId);
    expect(pending!.level).toBe(2);
    await expect(svc.decideApproval(await ctxFor("hos"), pending!.id, false, "Too early")).resolves.toMatchObject({ status: "REJECTED" }); // management may override
    await svc.submitQuote(exec, quoteId);
    const again = await pendingApproval(exec, "Quote", quoteId);
    expect((await svc.decideApproval(bm, again!.id, true)).status).toBe("PENDING");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("PENDING_APPROVAL");
    expect((await pendingApproval(exec, "Quote", quoteId))!.approverId).toBe(await userId("hos"));
    await svc.decideApproval(await ctxFor("hos"), again!.id, false, "Too high");
    expect((await getDocument(exec, "quote", quoteId)).status).toBe("DRAFT");

    // price book max for this product is 3 % (Standard) – lower it to 1 % and quote 2 %
    const book = await unsafeDb.priceBook.findFirstOrThrow({ where: { brandId: I.brand("HMNL"), isDefault: true } });
    await unsafeDb.priceBookEntry.update({ where: { priceBookId_productId: { priceBookId: book.id, productId: model.id } }, data: { maxDiscountPct: 1 } });
    await svc.saveDocument(exec, "quote", quoteId, { lines: [lineOf({ discountPct: 2 })] as never });
    expect((await svc.submitQuote(exec, quoteId)).status).toBe("PENDING_APPROVAL");
    await unsafeDb.priceBookEntry.update({ where: { priceBookId_productId: { priceBookId: book.id, productId: model.id } }, data: { maxDiscountPct: 3 } });
  });

  it("the Brand Manager's own discounted quote is approved directly (they are the approver)", async () => {
    const deal = await newDeal(bm);
    const q = await svc.createQuoteFromDeal(bm, deal.id);
    await svc.saveDocument(bm, "quote", q.id, { lines: [lineOf({ discountPct: 5 })] as never });
    expect((await svc.submitQuote(bm, q.id)).status).toBe("APPROVED");
  });

  it("one accepted quote per deal", async () => {
    const deal = await newDeal(exec);
    const a = await svc.createQuoteFromDeal(exec, deal.id);
    const b = await svc.createQuoteFromDeal(exec, deal.id);
    for (const q of [a, b]) await svc.submitQuote(exec, q.id);
    await svc.acceptQuote(exec, a.id);
    await expect(svc.acceptQuote(exec, b.id)).rejects.toThrow(/already accepted/);
  });
});

describe("quote → sales order → invoice", () => {
  it("full flow: accept, convert, confirm (ERP event), allocate needs a reserved VIN, deliver advances the deal, invoice and payments", async () => {
    const { dealId, quoteId } = await newQuote();
    await svc.submitQuote(exec, quoteId);
    await expect(svc.convertQuoteToOrder(exec, quoteId)).rejects.toThrow(/accepted quote/);
    await svc.acceptQuote(exec, quoteId);
    const order = await svc.convertQuoteToOrder(exec, quoteId);
    await expect(svc.convertQuoteToOrder(exec, quoteId)).rejects.toThrow(/already exists/);
    const so = await getDocument(exec, "salesOrder", order.id);
    const quote = await getDocument(exec, "quote", quoteId);
    expect(so.number).toMatch(new RegExp(`^HMNL-SO-${year}-\\d{5}$`));
    expect(so).toMatchObject({ status: "DRAFT", total: quote.total, sourceDocumentId: quoteId, brandId: quote.brandId, regionId: quote.regionId });
    expect(so.lines.map((l) => [l.productId, l.qty, l.unitPrice])).toEqual(quote.lines.map((l) => [l.productId, l.qty, l.unitPrice]));

    const eventsBefore = await unsafeDb.domainEvent.count();
    await svc.confirmOrder(exec, order.id);
    const event = await unsafeDb.domainEvent.findFirstOrThrow({ where: { name: "document.confirmed" }, orderBy: { createdAt: "desc" } });
    expect(await unsafeDb.domainEvent.count()).toBe(eventsBefore + 2); // document.confirmed + salesorder.confirmed (prompt 13)
    expect(event.name).toBe("document.confirmed");
    expect(event.payload).toMatchObject({ documentType: "salesOrder", number: so.number, brandCode: "HMNL", erpCompanyCode: "ERP-HMNL" });

    await expect(svc.allocateOrder(exec, order.id)).rejects.toThrow(/Reserve a vehicle/);
    const stock = await unsafeDb.vehicleUnit.findFirstOrThrow({ where: { brandId: I.brand("HMNL"), productId: model.id, status: "AVAILABLE" } });
    await reserveVin(exec, dealId, stock.id);
    await svc.allocateOrder(exec, order.id);
    expect((await getDocument(exec, "salesOrder", order.id)).lines[0]!.vin).toBe(stock.vin);

    await svc.deliverOrder(exec, order.id, "2026-11-15");
    const deal = await getDeal(exec, dealId);
    expect(deal).toMatchObject({ stage: "DELIVERY", vinChassisNo: stock.vin });
    expect(deal.deliveryDate?.slice(0, 10)).toBe("2026-11-15");
    expect((await getDocument(exec, "salesOrder", order.id)).status).toBe("DELIVERED");

    const inv = await svc.convertOrderToInvoice(exec, order.id);
    const invoice = await getDocument(exec, "invoice", inv.id);
    expect(invoice.number).toMatch(new RegExp(`^HMNL-INV-${year}-\\d{5}$`));
    await expect(svc.addPayment(exec, inv.id, { amount: 1000, method: "CASH" })).rejects.toThrow(/issued invoices/);
    await svc.issueInvoice(exec, inv.id);
    expect((await unsafeDb.domainEvent.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).payload).toMatchObject({ documentType: "invoice", number: invoice.number });
    expect((await svc.addPayment(exec, inv.id, { amount: 5_000_000, method: "TRANSFER", reference: "DEP-1" })).status).toBe("PART_PAID");
    await expect(svc.addPayment(exec, inv.id, { amount: invoice.total, method: "TRANSFER" })).rejects.toThrow(/exceeds/);
    expect((await svc.addPayment(exec, inv.id, { amount: invoice.total - 5_000_000, method: "TRANSFER" })).status).toBe("PAID");
    const paid = await getDocument(exec, "invoice", inv.id);
    expect(paid).toMatchObject({ status: "PAID", amountPaid: invoice.total });
    expect(paid.payments).toHaveLength(2);
    await expect(svc.voidInvoice(exec, inv.id)).rejects.toThrow();
  });

  it("management can read documents but not create or change them", async () => {
    const { dealId, quoteId } = await newQuote();
    const md = await ctxFor("md");
    expect((await getDocument(md, "quote", quoteId)).id).toBe(quoteId);
    await expect(svc.createQuoteFromDeal(md, dealId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.submitQuote(md, quoteId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("PDF", () => {
  it("is issued by the correct brand's legal entity", async () => {
    const { quoteId } = await newQuote();
    const model1 = await documentPdfModel(exec, "quote", quoteId);
    expect(model1.brand).toMatchObject({ code: "HMNL", legalEntity: "Hypothetical Motors Nigeria Ltd", bankDetails: "Example Bank 0000000000" });
    const bytes = await renderDocumentPdf(model1);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getAuthor()).toBe("Hypothetical Motors Nigeria Ltd");
    expect(parsed.getTitle()).toBe(`QUOTE ${model1.doc.number}`);
    expect(parsed.getPageCount()).toBeGreaterThan(0);

    const d = await newDeal(snmnl, "SNMNL");
    const q = await svc.createQuoteFromDeal(snmnl, d.id);
    const other = await PDFDocument.load(await renderDocumentPdf(await documentPdfModel(snmnl, "quote", q.id)));
    expect(other.getAuthor()).toBe("Sample Nippon Motors Nigeria Ltd");
  });
});
