import { beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { getDocument } from "@/server/modules/documents/queries";
import * as quotes from "@/server/modules/documents/quote-page";
import * as svc from "@/server/modules/documents/service";
import * as page from "@/server/modules/documents/so-page";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** The Create Sales Order page on the server. */
let exec: AccessContext;
let bm: AccessContext;
let snExec: AccessContext;
let I: Awaited<ReturnType<typeof ids>>;
const VAT = [{ name: "VAT", rate: 7.5 }];
const setRules = (rules: Record<string, unknown>) => unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { documentRules: rules as object } });
const base = (over: Record<string, unknown> = {}) => ({
  brandId: I.brand("HMNL"),
  subject: "Tucson – Adeyemi",
  customerName: "Tunde Adeyemi",
  lines: [{ description: "Floor mats", qty: 2, unitPrice: 50_000, taxes: VAT }],
  ...over,
});

beforeAll(async () => {
  I = await ids();
  [exec, bm, snExec] = (await Promise.all(["exec.hmnl.1", "bm.hmnl", "exec.snmnl.1"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext];
  await setRules({});
});

describe("create sales order page", () => {
  it("saves the page fields; Created; carrier from the brand list; other charges in the total and kept on later line edits", async () => {
    const so = await page.saveOrderPage(exec, null, base({ customerNo: "C-1001", customerPoRef: "PO-77", pending: "Deposit", carrier: "DHL", dueDate: "2026-12-01", otherCharges: 25_000, exciseDuty: 10_000, phone: "+2348030000000" }));
    let d = await getDocument(exec, "salesOrder", so.id);
    expect(d.status).toBe("DRAFT");
    expect(d.order).toMatchObject({ subject: "Tucson – Adeyemi", customerNo: "C-1001", customerPoRef: "PO-77", pending: "Deposit", carrier: "DHL", dueDate: "2026-12-01", otherCharges: 25_000, exciseDuty: 10_000 });
    expect(d.total).toBe(132_500); // 107,500 + 25,000 other charges; excise not in the total by default
    // a line edit on the record page keeps the charges in the total
    await svc.saveDocument(exec, "salesOrder", so.id, { lines: [{ id: d.lines[0]!.id, description: "Floor mats", qty: 1, unitPrice: 50_000, taxes: VAT }] as never });
    d = await getDocument(exec, "salesOrder", so.id);
    expect(d.total).toBe(78_750);
    await expect(page.saveOrderPage(exec, null, base({ carrier: "Pigeon" }))).rejects.toThrow(/carrier/);
    await expect(page.saveOrderPage(exec, null, base({ subject: "" }))).rejects.toThrow(/subject/i);
  });

  it("from a quote: copies customer, contact, deal and lines; the quote is the source", async () => {
    const q = await quotes.saveQuotePage(exec, null, { brandId: I.brand("HMNL"), subject: "Q", customerName: "Quote Customer", phone: "+2348031111111", email: "q@example.test", lines: [{ description: "Service", qty: 3, unitPrice: 10_000, taxes: VAT }] });
    const copy = await page.quoteForOrder(exec, q.id);
    expect(copy.customerName).toBe("Quote Customer");
    expect(copy.phone).toBe("+2348031111111");
    expect(copy.lines.map((l) => [l.description, l.qty])).toEqual([["Service", 3]]);
    const so = await page.saveOrderPage(exec, null, base({ quoteId: q.id, customerName: copy.customerName, lines: copy.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, taxes: l.taxes })) }));
    expect((await getDocument(exec, "salesOrder", so.id)).sourceDocumentId).toBe(q.id);
  });

  it("edit while Created; another brand cannot see it", async () => {
    const so = await page.saveOrderPage(exec, null, base());
    await page.saveOrderPage(exec, so.id, base({ subject: "Changed", customerNo: "C-2" }));
    const d = await getDocument(exec, "salesOrder", so.id);
    expect(d.order!.subject).toBe("Changed");
    await expect(getDocument(snExec, "salesOrder", so.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(page.orderFormData(exec, I.brand("SNMNL"))).rejects.toBeInstanceOf(NotFoundError);
    await svc.confirmOrder(bm, so.id);
    await expect(page.saveOrderPage(exec, so.id, base())).rejects.toThrow(/only be changed while it is Created/);
  });
});
