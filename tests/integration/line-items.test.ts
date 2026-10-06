import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import * as approvals from "@/server/modules/approvals/service";
import { calcDocument } from "@/server/modules/documents/calc";
import { brandProducts } from "@/server/modules/documents/lookups";
import { getDocument } from "@/server/modules/documents/queries";
import * as docs from "@/server/modules/documents/service";
import { ctxFor, ids, unsafeDb } from "./helpers";

/** Ordered Items grid (prompt 24 §8) – the server side: calculations, approvals, VINs, conversion, partial invoices. */
let hmnlExec: AccessContext;
let bmHmnl: AccessContext;
let admin: AccessContext;
let id: Awaited<ReturnType<typeof ids>>;
let vehicle: { id: string; price: number; max: number };
const VAT = [{ name: "VAT", rate: 7.5 }];
const billTo = { name: "Grid Customer" };
const item = (description: string, extra: Record<string, unknown> = {}) => ({ description, qty: 1, unitPrice: 10_000, taxes: VAT, ...extra });
const setRules = (rules: Record<string, unknown>) => unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { documentRules: rules as object } });

beforeAll(async () => {
  [hmnlExec, bmHmnl, admin] = (await Promise.all(["exec.hmnl.1", "bm.hmnl", "admin"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext];
  id = await ids();
  await setRules({});
  const e = await unsafeDb.priceBookEntry.findFirstOrThrow({ where: { priceBook: { brandId: id.brand("HMNL"), active: true }, maxDiscountPct: { not: null }, product: { category: "VEHICLE", active: true } }, select: { productId: true, price: true, maxDiscountPct: true } });
  vehicle = { id: e.productId, price: Number(e.price), max: Number(e.maxDiscountPct) };
});

describe("lines and calculations", () => {
  it("12 lines; reordering and deleting keep the lines (ids, history) and renumber", async () => {
    const order = await docs.createDocument(hmnlExec, "salesOrder", { billTo, lines: Array.from({ length: 12 }, (_, i) => item(`Item ${i + 1}`)) });
    let d = await getDocument(hmnlExec, "salesOrder", order.id);
    expect(d.lines.map((l) => l.position)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // move line 12 to the top, delete line 2, change the quantity of line 5
    const moved = [d.lines[11]!, ...d.lines.slice(0, 11)].filter((l) => l.description !== "Item 2").map((l) => ({ id: l.id, description: l.description, qty: l.description === "Item 5" ? 3 : l.qty, unitPrice: l.unitPrice, taxes: VAT }));
    await docs.saveDocument(hmnlExec, "salesOrder", order.id, { lines: moved as never });
    d = await getDocument(hmnlExec, "salesOrder", order.id);
    expect(d.lines.map((l) => l.description)).toEqual(["Item 12", "Item 1", "Item 3", "Item 4", "Item 5", "Item 6", "Item 7", "Item 8", "Item 9", "Item 10", "Item 11"]);
    expect(d.lines.map((l) => l.position)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    expect(d.lines.find((l) => l.description === "Item 12")!.id).toBe(moved[0]!.id); // the same line, not a new one
    const history = await unsafeDb.auditLog.findMany({ where: { entity: "DocumentLine", entityId: d.lines.find((l) => l.description === "Item 5")!.id } });
    expect(history.map((h) => [h.before, (h.after as Record<string, unknown>).qty])).toEqual([[{ qty: "1" }, 3]]);
    await expect(docs.saveDocument(hmnlExec, "salesOrder", order.id, { lines: Array.from({ length: 201 }, (_, i) => item(`X${i}`)) as never })).rejects.toThrow(/200/);
  });

  it("% and amount discounts, several taxes, document discount and adjustment – the server equals the shared calculation", async () => {
    await setRules({ taxes: [{ name: "VAT", rate: 7.5 }, { name: "Levy", rate: 2 }] });
    try {
      const lines = [
        { description: "SUV", qty: 1, unitPrice: 25_000_000, discountType: "PERCENT", discountValue: 2, taxes: VAT },
        { description: "Mats", qty: 4, unitPrice: 12_345.67, discountType: "AMOUNT", discountValue: 1_000, taxes: [...VAT, { name: "Levy", rate: 2 }] },
        { description: "Service", qty: 1, unitPrice: 150_000, taxes: [] },
      ];
      const header = { headerDiscountType: "AMOUNT" as const, headerDiscountValue: 50_000, adjustment: -0.53 };
      const q = await docs.createDocument(hmnlExec, "quote", { billTo, lines, ...header } as never);
      const d = await getDocument(hmnlExec, "quote", q.id);
      const expected = calcDocument(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountType: (l.discountType ?? "PERCENT") as "PERCENT" | "AMOUNT", discountValue: l.discountValue ?? 0, taxes: l.taxes })), { discountType: "AMOUNT", discountValue: 50_000, taxes: [], adjustment: -0.53, taxMode: "LINE" });
      expect(d.total).toBe(expected.grandTotal);
      expect(d.taxTotal).toBe(expected.taxTotal);
      expect(d.discountTotal).toBe(expected.discountTotal);
      expect(d.adjustment).toBe(-0.53);
      expect(d.lines[0]).toMatchObject({ amount: 25_000_000, discountAmount: 500_000, taxAmount: 1_837_500, total: 26_337_500, discountType: "PERCENT", discountValue: 2 });
      expect(d.lines[1]!.taxes.map((t) => t.name)).toEqual(["VAT", "Levy"]);
      expect(d.lines[1]).toMatchObject({ amount: 49_382.68, discountAmount: 1_000, discountType: "AMOUNT" });
      // a discount larger than the amount is refused
      await expect(docs.saveDocument(hmnlExec, "quote", q.id, { lines: [{ description: "X", qty: 1, unitPrice: 100, discountType: "AMOUNT", discountValue: 500 }] as never })).rejects.toThrow(/larger than the amount/);
      // document-level tax mode
      await setRules({ taxMode: "DOCUMENT" });
      await docs.saveDocument(hmnlExec, "quote", q.id, { lines: [{ description: "X", qty: 2, unitPrice: 1_000 }] as never, documentTaxes: VAT } as never);
      const doc2 = await getDocument(hmnlExec, "quote", q.id);
      expect(doc2).toMatchObject({ total: 2_150, taxTotal: 150 });
      expect(doc2.lines[0]!.taxAmount).toBe(0);
    } finally {
      await setRules({});
    }
  });

  it("the adjustment can be limited to the brand's managers", async () => {
    await setRules({ adjustmentManagersOnly: true });
    try {
      await expect(docs.createDocument(hmnlExec, "quote", { billTo, lines: [item("A")], adjustment: 5 } as never)).rejects.toThrow(/managers can enter an adjustment/);
      expect((await docs.createDocument(bmHmnl, "quote", { billTo, lines: [item("A")], adjustment: 5, brandId: id.brand("HMNL"), regionId: id.region("Lagos") } as never)).id).toBeTruthy();
    } finally {
      await setRules({});
    }
  });

  it("products come from the record's brand only; free text is allowed unless the brand requires products", async () => {
    const list = await brandProducts(hmnlExec, id.brand("HMNL"));
    const brands = await unsafeDb.product.findMany({ where: { id: { in: list.map((p) => p.id) } }, select: { brandId: true } });
    expect(new Set(brands.map((b) => b.brandId))).toEqual(new Set([id.brand("HMNL")]));
    await expect(brandProducts(hmnlExec, id.brand("SNMNL"))).rejects.toThrow(/not found/i);
    await setRules({ requireProduct: true });
    try {
      await expect(docs.createDocument(hmnlExec, "salesOrder", { billTo, lines: [item("Free text")] })).rejects.toThrow(/product on every line/);
    } finally {
      await setRules({});
    }
  });
});

describe("approval, VINs, conversion", () => {
  it("a discount above the price book maximum marks the line and blocks Confirm until approved", async () => {
    const so = await docs.createDocument(hmnlExec, "salesOrder", { billTo, lines: [{ productId: vehicle.id, description: "Vehicle", qty: 1, discountValue: vehicle.max + 1 }] } as never);
    const d = await getDocument(hmnlExec, "salesOrder", so.id);
    expect(d.lines[0]!.needsApproval).toBe(true);
    await expect(docs.confirmOrder(hmnlExec, so.id)).rejects.toThrow(/request approval/);
    expect((await docs.requestOrderDiscountApproval(hmnlExec, so.id)).status).toBe("PENDING");
    const task = (await approvals.myApprovalTasks(bmHmnl)).find((t) => t.entityId === so.id)!;
    await approvals.decide(bmHmnl, task.requestId, true);
    await docs.confirmOrder(hmnlExec, so.id);
    expect((await getDocument(hmnlExec, "salesOrder", so.id)).status).toBe("CONFIRMED");
    // lines are locked after confirmation; a manager can reopen
    await expect(docs.saveDocument(hmnlExec, "salesOrder", so.id, { lines: [item("X")] as never })).rejects.toThrow(/draft/);
    await expect(docs.reopenOrder(hmnlExec, so.id)).rejects.toThrow(/managers/);
    await docs.reopenOrder(bmHmnl, so.id);
    expect((await getDocument(hmnlExec, "salesOrder", so.id)).status).toBe("DRAFT");
  });

  it("a vehicle line with quantity 2 saves without VINs but needs two before allocation; duplicate VINs are refused", async () => {
    const stamp = String(Date.now()).slice(-8);
    const so = await docs.createDocument(hmnlExec, "salesOrder", { billTo, lines: [{ productId: vehicle.id, description: "Vehicle", qty: 2 }] } as never);
    await docs.confirmOrder(hmnlExec, so.id);
    await expect(docs.allocateOrder(hmnlExec, so.id)).rejects.toThrow(/VIN/);
    const line = (await getDocument(hmnlExec, "salesOrder", so.id)).lines[0]!;
    await expect(docs.assignVins(hmnlExec, so.id, { [line.id]: [`VINA${stamp}`, `VINA${stamp}`] })).rejects.toThrow(/twice/);
    await docs.assignVins(hmnlExec, so.id, { [line.id]: [`VINA${stamp}`] });
    await expect(docs.allocateOrder(hmnlExec, so.id)).rejects.toThrow(/needs 2 VIN/);
    await docs.assignVins(hmnlExec, so.id, { [line.id]: [`VINA${stamp}`, `VINB${stamp}`] });
    await docs.allocateOrder(hmnlExec, so.id);
    // the same VIN on another open order of the brand is refused
    await expect(docs.createDocument(hmnlExec, "salesOrder", { billTo, lines: [{ productId: vehicle.id, description: "Vehicle", qty: 1, vins: [`VINB${stamp}`] }] } as never)).rejects.toThrow(/already on the open sales order/);
  });

  it("quote → order → invoice keeps the lines; a partial invoice leaves the right remaining quantities", async () => {
    const q = await docs.createDocument(hmnlExec, "quote", {
      billTo,
      lines: [
        { description: "Mats", qty: 10, unitPrice: 5_000, discountType: "AMOUNT", discountValue: 500, taxes: VAT, details: "Rubber, black" },
        { description: "Tint", qty: 4, unitPrice: 20_000, discountType: "PERCENT", discountValue: 1, taxes: VAT },
      ],
      headerDiscountType: "PERCENT",
      headerDiscountValue: 0.5,
    } as never);
    await docs.submitQuote(hmnlExec, q.id);
    await docs.acceptQuote(hmnlExec, q.id);
    const so = await docs.convertQuoteToOrder(hmnlExec, q.id);
    const [quote, order] = await Promise.all([getDocument(hmnlExec, "quote", q.id), getDocument(hmnlExec, "salesOrder", so.id)]);
    const shape = (l: (typeof quote.lines)[number]) => [l.position, l.description, l.details, l.qty, l.unitPrice, l.discountType, l.discountValue, l.taxes, l.total];
    expect(order.lines.map(shape)).toEqual(quote.lines.map(shape));
    expect(order.total).toBe(quote.total);
    expect(order.lines.map((l) => l.sourceLineId)).toEqual(quote.lines.map((l) => l.id));

    await docs.confirmOrder(hmnlExec, so.id);
    const [mats, tint] = order.lines;
    const inv1 = await docs.convertOrderToInvoice(hmnlExec, so.id, { [mats!.id]: 4, [tint!.id]: 0 });
    let after = await getDocument(hmnlExec, "salesOrder", so.id);
    expect(after.lines.map((l) => l.invoicedQty)).toEqual([4, 0]);
    const first = await getDocument(hmnlExec, "invoice", inv1.id);
    expect(first.lines.map((l) => [l.description, l.qty])).toEqual([["Mats", 4]]);
    await expect(docs.convertOrderToInvoice(hmnlExec, so.id, { [mats!.id]: 7 })).rejects.toThrow(/at most 6/);
    const inv2 = await docs.convertOrderToInvoice(hmnlExec, so.id);
    after = await getDocument(hmnlExec, "salesOrder", so.id);
    expect(after.lines.map((l) => l.invoicedQty)).toEqual([10, 4]);
    expect((await getDocument(hmnlExec, "invoice", inv2.id)).lines.map((l) => [l.description, l.qty])).toEqual([["Mats", 6], ["Tint", 4]]);
    await expect(docs.convertOrderToInvoice(hmnlExec, so.id)).rejects.toThrow(/invoiced already/);
    // voiding an invoice gives its quantities back to the order
    await docs.voidInvoice(hmnlExec, inv1.id);
    expect((await getDocument(hmnlExec, "salesOrder", so.id)).lines.map((l) => l.invoicedQty)).toEqual([6, 4]);
    void admin;
  });
});
