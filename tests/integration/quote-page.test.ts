import { beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { getDocument } from "@/server/modules/documents/queries";
import * as page from "@/server/modules/documents/quote-page";
import { ctxFor, ids } from "./helpers";

/** The Create Quote page on the server. */
let exec: AccessContext;
let admin: AccessContext;
let snExec: AccessContext;
let I: Awaited<ReturnType<typeof ids>>;
const VAT = [{ name: "VAT", rate: 7.5 }];
const base = (over: Record<string, unknown> = {}) => ({
  brandId: I.brand("HMNL"),
  subject: "Tucson 2.0 GLS – Adeyemi",
  orgName: "Adeyemi Logistics",
  orgCity: "Ikeja",
  customerName: "Tunde Adeyemi",
  phone: "+2348030000000",
  email: "tunde@example.test",
  lines: [{ description: "Service", qty: 2, unitPrice: 50_000, taxes: VAT }],
  ...over,
});

beforeAll(async () => {
  I = await ids();
  [exec, admin, snExec] = (await Promise.all(["exec.hmnl.1", "admin", "exec.snmnl.1"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext];
});

describe("create quote page", () => {
  it("saves the page fields; owner = creator; valid for 14 days; NGN at rate 1", async () => {
    const q = await page.saveQuotePage(exec, null, base({ tinNumber: "12345678-0001" }));
    const d = await getDocument(exec, "quote", q.id);
    expect(d.quote).toMatchObject({ subject: "Tucson 2.0 GLS – Adeyemi", orgName: "Adeyemi Logistics", orgCity: "Ikeja", phone: "+2348030000000", email: "tunde@example.test", tinNumber: "12345678-0001", exchangeRate: 1 });
    expect(d.ownerId).toBe(exec.userId);
    expect(d.status).toBe("DRAFT");
    expect(d.date).toBe(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
    expect(d.total).toBe(107_500);
    expect(d.billTo).toMatchObject({ name: "Tunde Adeyemi", company: "Adeyemi Logistics", phone: "+2348030000000" });
  });

  it("phone and e-mail are required; TIN format; valid until not before the quote date; admins get a region", async () => {
    await expect(page.saveQuotePage(exec, null, base({ phone: "" }))).rejects.toThrow(/phone/);
    await expect(page.saveQuotePage(exec, null, base({ email: "nope" }))).rejects.toThrow(/e-mail/);
    await expect(page.saveQuotePage(exec, null, base({ tinNumber: "12" }))).rejects.toThrow(/TIN/);
    await expect(page.saveQuotePage(exec, null, base({ quoteDate: "2026-10-05", validUntil: "2026-10-01" }))).rejects.toThrow(/Valid until/);
    expect((await page.saveQuotePage(admin, null, base())).id).toBeTruthy();
  });

  it("edit while draft; another brand cannot see it", async () => {
    const q = await page.saveQuotePage(exec, null, base());
    await page.saveQuotePage(exec, q.id, base({ subject: "Changed", lines: [{ description: "Service", qty: 1, unitPrice: 50_000, taxes: VAT }] }));
    const d = await getDocument(exec, "quote", q.id);
    expect(d.quote!.subject).toBe("Changed");
    expect(d.total).toBe(53_750);
    await expect(getDocument(snExec, "quote", q.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(page.quoteFormData(exec, I.brand("SNMNL"))).rejects.toBeInstanceOf(NotFoundError);
  });
});
