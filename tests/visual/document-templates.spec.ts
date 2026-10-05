/**
 * Visual baselines of the document-template starters (prompt 21 §7) and the paging rules: a line-items table over
 * three pages with the letterhead and header repeated on each. The compiler and renderer are pure functions, so the
 * pages are rendered from a fixed fictitious record – no sign-in, no database.
 */
import { expect, test } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { compileDoc, type DocContent } from "../../src/server/modules/doctpl/content";
import { DOC_STARTERS } from "../../src/server/modules/doctpl/starters";
import { renderRecordsHtml, type PrintOptions } from "../../src/server/modules/print/blocks";
import { LETTERHEAD, sampleRecord } from "../fixtures/print-record";

const options = (paper: "A4" | "LETTER" | "A5"): PrintOptions => ({ paper, orientation: "portrait", printedBy: "Femi Coker", printedAt: new Date("2026-10-05T09:00:00Z"), appUrl: "https://crm.example" });
const html = (content: DocContent, module: string, paper: "A4" | "LETTER" | "A5", lines = 3) => {
  const record = sampleRecord(module, { lines });
  return renderRecordsHtml({ records: [record], layout: compileDoc(content, record, LETTERHEAD, { printedBy: "Femi Coker" }), letterheadFor: () => LETTERHEAD, options: options(paper) });
};

for (const s of DOC_STARTERS) {
  test(`starter: ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1250 });
    // "today" is the only moving value: the starters that print it get a fixed date
    await page.setContent(html(s.content, s.module, s.paper).replace(/\d{2}\/\d{2}\/20\d{2}(?=<\/p>)/g, "05/10/2026"));
    await expect(page.locator('[data-letterhead="DEMO"]')).toBeVisible();
    await expect(page).toHaveScreenshot(`starter-${s.key}.png`, { fullPage: true, mask: s.content.body.some((b) => b.type === "rich" && b.html.includes("{{today}}")) ? [page.locator(".rich").first()] : [] });
  });
}

test("a line-items table over three or more pages repeats the letterhead, the header and the column header on every page", async ({ page }) => {
  const content: DocContent = {
    letterhead: { show: true, logo: "left", details: "beside" },
    header: '<p>Statement of items – <a href="https://marker.example/header">reference</a></p>',
    body: [{ type: "title", text: "TAX INVOICE", showNumber: true, showDates: true }, { type: "lineItems", columns: ["sn", "description", "quantity", "lineTotal"], zebra: true }, { type: "totals", words: true }],
    footer: '<p>Demo Motors Nigeria Ltd · <a href="https://marker.example/footer">terms</a></p><p>Page {{page}} of {{pages}}</p>',
  };
  await page.setContent(html(content, "invoices", "A4", 75));
  await page.emulateMedia({ media: "print" });
  const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  // a link in the header / footer becomes one link annotation per page it is printed on
  const links = pdf.getPages().map((p) => {
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const uris: string[] = [];
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const uri = annots!.lookupMaybe(i, PDFDict)?.lookupMaybe(PDFName.of("A"), PDFDict)?.lookupMaybe(PDFName.of("URI"), PDFString);
      if (uri) uris.push(uri.decodeText());
    }
    return [...new Set(uris)].sort(); // Chromium writes several annotations for one link
  });
  expect(links).toEqual(Array.from({ length: pdf.getPageCount() }, () => ["https://marker.example/footer", "https://marker.example/header"]));
  // the column header of the items is a real table header (repeated by the browser on every page), rows never split
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('table.t[data-table="lines"] thead')!).display)).toBe("table-header-group");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('table.t[data-table="lines"] tbody tr')!).breakInside)).toBe("avoid");
  expect(await page.locator('table.t[data-table="lines"] tbody tr').count()).toBe(75);
  await expect(page.locator("[data-words]")).toContainText("Thirty-Two Million, Two Hundred and Fifty Thousand Naira Only");
});
