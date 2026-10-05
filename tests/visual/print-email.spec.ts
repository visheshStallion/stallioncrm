/**
 * Visual baselines for printouts and e-mails (prompt 20 Part C). The renderers are pure functions, so the pages are
 * rendered straight from fixed sample data – no sign-in, no database:
 *  - an e-mail in the brand layout at 600 px (desktop client) and 375 px (phone),
 *  - a quotation with 70 line items: several pages, the column header repeated on each.
 */
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { renderEmailHtml } from "../../src/server/modules/email/blocks";
import { EMAIL_STARTERS } from "../../src/server/modules/email/starters";
import { defaultLayout, renderRecordsHtml, type Letterhead } from "../../src/server/modules/print/blocks";
import type { PrintRecord } from "../../src/server/modules/print/describe";

const BRAND = { code: "DEMO", name: "Demo Motors", legalEntity: "Demo Motors Nigeria Ltd", address: "1 Sample Road, Lagos", phone: "+234 800 000 0000", website: "https://demo.example", color: "#1565d0", logoUrl: null };
const MERGE = { contact: { firstName: "Ada", name: "Ada Okafor" }, deal: { name: "SUV – Acme Logistics", model: "SUV Premium" }, brand: { name: "Demo Motors", code: "DEMO" }, owner: { name: "Femi Coker" }, user: { name: "Femi Coker", email: "femi@demo.example" } };

for (const [name, width] of [["desktop", 600], ["mobile", 375]] as const) {
  test(`e-mail in the brand layout – ${name} (${width} px)`, async ({ page }) => {
    const doc = EMAIL_STARTERS.find((s) => s.key === "new-model-launch")!.doc;
    const html = renderEmailHtml(doc, { brand: BRAND, merge: MERGE, signatureHtml: "<p>Femi Coker<br>Sales Executive</p>", unsubscribeUrl: "https://demo.example/unsubscribe" });
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(html);
    // nothing may be wider than the screen of a phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByText("Dear Ada,")).toBeVisible();
    await expect(page).toHaveScreenshot(`email-${name}.png`, { fullPage: true });
  });
}

test("a quotation with many line items prints on several pages with the letterhead", async ({ page }) => {
  const lines = { key: "lines", title: "Items", columns: [{ key: "n", label: "#", align: "left" as const }, { key: "d", label: "Description", align: "left" as const }, { key: "q", label: "Qty", align: "right" as const }, { key: "t", label: "Total", align: "right" as const }], rows: Array.from({ length: 70 }, (_, i) => [String(i + 1), `Accessory pack ${i + 1}`, "1", "125,000.00"]) };
  const record: PrintRecord = { module: "quotes", moduleLabel: "Quotation", id: "sample", title: "Q-2026-00045", number: "Q-2026-00045", brandId: "demo", fields: [{ key: "account", label: "Customer", value: "Acme Logistics", kind: "text" }, { key: "validUntil", label: "Valid until", value: "31/12/2026", kind: "date" }], tables: [lines], lines, totals: [{ label: "Subtotal", value: "8,750,000.00", strong: false }, { label: "Total", value: "₦ 9,406,250.00", strong: true }], terms: "Prices are valid for 14 days.", vin: null, merge: { quote: { number: "Q-2026-00045" } } };
  const letterhead: Letterhead = { brandId: "demo", code: "DEMO", name: "Demo Motors", legalEntity: "Demo Motors Nigeria Ltd", rcNumber: "RC 000000", address: "1 Sample Road, Lagos", phone: "+234 800 000 0000", email: "sales@demo.example", website: "demo.example", vatNumber: null, bankDetails: null, color: "#1565d0", footerText: null, logo: null };
  const html = renderRecordsHtml({ records: [record], layout: defaultLayout(record), letterheadFor: () => letterhead, options: { paper: "A4", orientation: "portrait", printedBy: "Femi Coker", printedAt: new Date("2026-10-05T09:00:00Z"), appUrl: "https://demo.example" } });
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.setContent(html);
  await expect(page.locator('[data-letterhead="DEMO"]').first()).toBeVisible();
  await expect(page).toHaveScreenshot("print-quotation.png", { fullPage: false });
  // paged output: more than one sheet, and the table header is a real <thead> (browsers repeat it on every page)
  await page.emulateMedia({ media: "print" });
  const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  expect(await page.locator("table thead").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("table thead")!).display)).toBe("table-header-group");
});
