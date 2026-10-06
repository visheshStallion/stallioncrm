import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import * as page from "@/server/modules/documents/invoice-page";
import { getDocument } from "@/server/modules/documents/queries";
import * as docs from "@/server/modules/documents/service";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** The Create Invoice page (prompt 26 §9) on the server. */
type C = AccessContext;
let exec: C;
let bm: C;
let admin: C;
let snExec: C;
let I: Awaited<ReturnType<typeof ids>>;
const VAT = [{ name: "VAT", rate: 7.5 }];
const HMNL = () => I.brand("HMNL");
const setRules = (rules: Record<string, unknown>) => unsafeDb.brand.update({ where: { id: HMNL() }, data: { documentRules: rules as object } });
const base = (over: Record<string, unknown> = {}) => ({
  brandId: HMNL(),
  subject: "Floor mats – Adeyemi",
  customerName: "Tunde Adeyemi",
  lines: [{ description: "Floor mats", qty: 2, unitPrice: 50_000, taxes: VAT }],
  ...over,
});

beforeAll(async () => {
  I = await ids();
  [exec, bm, admin, snExec] = (await Promise.all(["exec.hmnl.1", "bm.hmnl", "admin", "exec.snmnl.1"].map(ctxFor))) as [C, C, C, C];
  await setRules({});
});

describe("create invoice page", () => {
  it("defaults: owner, invoice date today, due = date + payment terms, Created, NGN at 1; a typed customer is the snapshot", async () => {
    await setRules({ paymentTermsDays: 30 });
    const res = await page.saveInvoicePage(exec, null, base({ billTo: { street: "12 Allen Avenue", city: "Ikeja", state: "Lagos", country: "Nigeria" } }));
    const d = await getDocument(exec, "invoice", res.id);
    expect(res.number).toMatch(/^HMNL-INV-\d{4}-\d{5}$/);
    expect(d.ownerId).toBe(exec.userId);
    expect(d.status).toBe("DRAFT");
    expect(d.issueDate).toBe(new Date().toISOString().slice(0, 10));
    expect(d.date).toBe(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
    expect(d.currency).toBe("NGN");
    expect(d.invoice!.exchangeRate).toBe(1);
    expect(d.invoice!.subject).toBe("Floor mats – Adeyemi");
    expect(d.billTo).toMatchObject({ name: "Tunde Adeyemi", address: "12 Allen Avenue", country: "Nigeria" });
    expect(d.accountId).toBeNull();
    expect(d.total).toBe(107_500);
    await setRules({});
  });

  it("required: subject, account name, an item; due date not before the invoice date; TIN format", async () => {
    await expect(page.saveInvoicePage(exec, null, base({ subject: "" }))).rejects.toThrow(/subject/i);
    await expect(page.saveInvoicePage(exec, null, base({ customerName: "" }))).rejects.toThrow(/account name/);
    await expect(page.saveInvoicePage(exec, null, base({ lines: [] }))).rejects.toThrow(/invoiced item/);
    await expect(page.saveInvoicePage(exec, null, base({ invoiceDate: "2026-10-05", dueDate: "2026-10-01" }))).rejects.toThrow(/due date/);
    await expect(page.saveInvoicePage(exec, null, base({ tinNumber: "12AB" }))).rejects.toThrow(/TIN/);
    expect((await page.saveInvoicePage(exec, null, base({ tinNumber: "12345678-0001" }))).id).toBeTruthy();
  });

  it("brand rules: a linked account required; TIN required for companies", async () => {
    await setRules({ requireAccount: true });
    await expect(page.saveInvoicePage(exec, null, base())).rejects.toThrow(/linked account/);
    const company = await unsafeDb.account.findFirstOrThrow({ where: { type: { not: "INDIVIDUAL" } } });
    await unsafeDb.account.update({ where: { id: company.id }, data: { taxId: null } });
    expect((await page.saveInvoicePage(admin, null, base({ accountId: company.id, customerName: undefined }))).id).toBeTruthy();
    await setRules({ tinRequiredB2B: true });
    await expect(page.saveInvoicePage(admin, null, base({ accountId: company.id }))).rejects.toThrow(/TIN/);
    await unsafeDb.account.update({ where: { id: company.id }, data: { taxId: "23456789-0001" } });
    const ok = await page.saveInvoicePage(admin, null, base({ accountId: company.id }));
    expect((await getDocument(admin, "invoice", ok.id)).invoice!.tinNumber).toBe("23456789-0001"); // from the account
    await setRules({});
  });

  it("Other Charges and Excise Duty in or out of the Grand Total per brand setting", async () => {
    const a = await page.saveInvoicePage(exec, null, base({ otherCharges: 25_000, exciseDuty: 10_000 }));
    expect((await getDocument(exec, "invoice", a.id)).total).toBe(132_500); // other charges in, excise out (defaults)
    await setRules({ exciseInTotal: true, otherChargesEnabled: false });
    const b = await page.saveInvoicePage(exec, null, base({ otherCharges: 25_000, exciseDuty: 10_000 }));
    const d = await getDocument(exec, "invoice", b.id);
    expect(d.total).toBe(117_500);
    expect(d.invoice!.otherCharges).toBe(0);
    expect(d.invoice!.exciseDuty).toBe(10_000);
    await setRules({});
  });

  it("from a sales order: only uninvoiced quantities; a second invoice gets the remainder; never more than ordered", async () => {
    const so = await docs.createDocument(exec, "salesOrder", { billTo: { name: "SO Customer", address: "1 Marina", city: "Lagos" }, lines: [{ description: "Tyres", qty: 4, unitPrice: 80_000, taxes: VAT }, { description: "Battery", qty: 1, unitPrice: 120_000, taxes: VAT }] } as never);
    await docs.confirmOrder(exec, so.id);
    expect((await page.openOrdersForInvoice(exec, HMNL())).map((o) => o.id)).toContain(so.id);
    const copy = await page.orderForInvoice(exec, so.id);
    expect(copy.customerName).toBe("SO Customer");
    expect(copy.billTo.street).toBe("1 Marina");
    expect(copy.lines.map((l) => [l.description, l.qty])).toEqual([["Tyres", 4], ["Battery", 1]]);
    const line = (l: (typeof copy.lines)[number], qty: number) => ({ description: l.description, qty, unitPrice: l.unitPrice, taxes: l.taxes, sourceLineId: l.sourceLineId });
    const first = await page.saveInvoicePage(exec, null, base({ salesOrderId: so.id, customerName: copy.customerName, lines: [line(copy.lines[0]!, 3)] }));
    await expect(page.saveInvoicePage(exec, null, base({ salesOrderId: so.id, lines: [line(copy.lines[0]!, 2)] }))).rejects.toThrow(/at most 1/);
    const again = await page.orderForInvoice(exec, so.id);
    expect(again.lines.map((l) => [l.description, l.qty])).toEqual([["Tyres", 1], ["Battery", 1]]);
    await page.saveInvoicePage(exec, null, base({ salesOrderId: so.id, lines: again.lines.map((l) => line(l, l.qty)) }));
    expect((await page.openOrdersForInvoice(exec, HMNL())).map((o) => o.id)).not.toContain(so.id);
    // editing the first invoice down to 2 gives one tyre back
    await page.saveInvoicePage(exec, first.id, base({ salesOrderId: so.id, lines: [line(copy.lines[0]!, 2)] }));
    expect((await page.orderForInvoice(exec, so.id)).lines.map((l) => [l.description, l.qty])).toEqual([["Tyres", 1]]);
  });

  it("brand isolation: another brand's account-free invoice, sales order or product is rejected; SNMNL cannot open it", async () => {
    const snProduct = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(page.saveInvoicePage(exec, null, base({ lines: [{ productId: snProduct.id, description: "x", qty: 1, unitPrice: 1 }] }))).rejects.toThrow();
    const snSo = await docs.createDocument(snExec, "salesOrder", { billTo: { name: "SN" }, lines: [{ description: "x", qty: 1, unitPrice: 1, taxes: [] }] } as never);
    await expect(page.saveInvoicePage(exec, null, base({ salesOrderId: snSo.id }))).rejects.toBeInstanceOf(NotFoundError);
    const mine = await page.saveInvoicePage(exec, null, base());
    await expect(getDocument(snExec, "invoice", mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(page.invoiceFormData(exec, I.brand("SNMNL"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("vehicle line without VIN saves but cannot be issued; a sales exec only requests; issue locks; overdue, payments, credit note, void with reason", async () => {
    const car = await unsafeDb.product.findFirstOrThrow({ where: { brandId: HMNL(), category: "VEHICLE", active: true } });
    const inv = await page.saveInvoicePage(exec, null, base({ lines: [{ productId: car.id, description: "Car", qty: 1, unitPrice: 10_000_000, taxes: VAT, isStockItem: true }] }));
    await expect(docs.issueInvoice(bm, inv.id)).rejects.toThrow(/VIN/);
    await page.saveInvoicePage(exec, inv.id, base({ lines: [{ productId: car.id, description: "Car", qty: 1, unitPrice: 10_000_000, taxes: VAT, isStockItem: true, vins: ["TESTINV26VIN00001"] }] }));
    await expect(docs.issueInvoice(exec, inv.id)).rejects.toBeInstanceOf(ForbiddenError); // no discount: nothing to approve, and execs do not issue
    expect((await docs.issueInvoice(bm, inv.id)).status).toBe("ISSUED");
    await expect(page.saveInvoicePage(exec, inv.id, base())).rejects.toThrow(/credit note/);
    const event = await unsafeDb.domainEvent.findFirst({ where: { name: "document.confirmed", payload: { path: ["documentId"], equals: inv.id } } });
    expect(event).not.toBeNull();

    // past due with a balance → Overdue (nightly)
    await unsafeDb.invoice.update({ where: { id: inv.id }, data: { dueDate: new Date(Date.now() - 2 * 86_400_000) } });
    await docs.markOverdueInvoices();
    expect((await getDocument(bm, "invoice", inv.id)).status).toBe("OVERDUE");
    const total = (await getDocument(bm, "invoice", inv.id)).total;
    await docs.addPayment(bm, inv.id, { amount: 1_000_000, method: "TRANSFER" });
    let d = await getDocument(bm, "invoice", inv.id);
    expect(d.amountPaid).toBe(1_000_000);
    expect(d.status).toBe("OVERDUE"); // still past due with a balance
    await expect(docs.createCreditNote(exec, inv.id, { amount: 100, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const cn = await docs.createCreditNote(bm, inv.id, { amount: 500_000, reason: "Agreed goodwill discount" });
    expect(cn.number).toMatch(/^HMNL-CN-\d{4}-\d{5}$/);
    d = await getDocument(bm, "invoice", inv.id);
    expect(d.invoice!.balanceDue).toBe(total - 1_500_000);
    await docs.addPayment(bm, inv.id, { amount: total - 1_500_000, method: "POS" });
    expect((await getDocument(bm, "invoice", inv.id)).status).toBe("PAID");
    await expect(docs.voidInvoice(bm, inv.id, "Wrong customer")).rejects.toThrow(/payments or credit notes/);

    // void: a reason is required; audited and the ERP told
    const other = await page.saveInvoicePage(exec, null, base());
    await expect(docs.voidInvoice(bm, other.id, "")).rejects.toThrow(/reason/);
    await docs.voidInvoice(bm, other.id, "Duplicate of another invoice");
    d = await getDocument(bm, "invoice", other.id);
    expect(d.status).toBe("VOID");
    expect(d.invoice!.voidReason).toBe("Duplicate of another invoice");
    expect(await unsafeDb.auditLog.count({ where: { entity: "Invoice", entityId: other.id, action: "UPDATE" } })).toBeGreaterThan(0);
  });

  it("a discount above the brand threshold: the exec's Issue sends it for approval; the Brand Manager approves; then it can be issued", async () => {
    const inv = await page.saveInvoicePage(exec, null, base({ lines: [{ description: "Service", qty: 1, unitPrice: 100_000, discountType: "PERCENT", discountValue: 10, taxes: VAT }] }));
    expect((await docs.issueInvoice(exec, inv.id)).status).toBe("PENDING_APPROVAL");
    await expect(docs.decideInvoice(exec, inv.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await docs.decideInvoice(bm, inv.id, true)).status).toBe("APPROVED");
    expect((await docs.issueInvoice(bm, inv.id)).status).toBe("ISSUED");
  });

  it("settings and invoice form views: administrators and Brand Admins only", async () => {
    await expect(page.saveInvoiceSettings(exec, HMNL(), { paymentTermsDays: 14, tinRequiredB2B: false, exciseInTotal: false, otherChargesEnabled: true })).rejects.toBeInstanceOf(ForbiddenError);
    await page.saveInvoiceSettings(admin, HMNL(), { paymentTermsDays: 14, tinRequiredB2B: false, exciseInTotal: false, otherChargesEnabled: true });
    expect((await page.invoiceFormData(exec, HMNL())).settings.paymentTermsDays).toBe(14);
    const v = await page.saveInvoiceFormView(admin, HMNL(), { name: "Fleet invoice", hidden: ["salesCommission", "bogus"] });
    const views = (await page.invoiceFormData(exec, HMNL())).settings.formViews;
    expect(views.find((x) => x.id === v.id)?.hidden).toEqual(["salesCommission"]);
    const inv = await page.saveInvoicePage(exec, null, base({ formViewId: v.id }));
    expect((await getDocument(exec, "invoice", inv.id)).invoice!.formViewId).toBe(v.id);
    await setRules({});
  });
});
