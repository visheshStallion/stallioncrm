import { describe, expect, it } from "vitest";
import { cleanCss, compileDoc, conditionHolds, sheetCss, splitFooter, valueOf, type DocContent } from "@/server/modules/doctpl/content";
import { DOC_STARTERS } from "@/server/modules/doctpl/starters";
import { amountInWords, brokenFields, numberWords, renderMerge } from "@/server/modules/messaging/merge";
import { pickColumns, renderRecordsHtml, type PrintOptions } from "@/server/modules/print/blocks";
import { PRINT_MODULE_OPTIONS } from "@/server/modules/print/modules";
import { contentSource } from "@/server/modules/doctpl/content";
import { LETTERHEAD, OTHER_LETTERHEAD, linesTable, sampleRecord } from "../../fixtures/print-record";

/** Document templates (prompt 21): the pure parts – words, conditions, the compiler, restricted CSS, starters. */
const options: PrintOptions = { paper: "A4", orientation: "portrait", printedBy: "Femi Coker", printedAt: new Date("2026-10-05T09:00:00Z"), appUrl: "https://crm.example" };
const page = (body: DocContent["body"], extra: Partial<DocContent> = {}): DocContent => ({ letterhead: { show: true, logo: "left", details: "beside" }, header: "", footer: "", body, ...extra });
const render = (content: DocContent, record = sampleRecord("invoices"), lh = LETTERHEAD) => renderRecordsHtml({ records: [record], layout: compileDoc(content, record, lh, { printedBy: "Femi Coker" }), letterheadFor: () => lh, options });

describe("amount in words", () => {
  it.each([
    [0, "Zero Naira Only"],
    [1, "One Naira Only"],
    [21, "Twenty-One Naira Only"],
    [105, "One Hundred and Five Naira Only"],
    [1_005, "One Thousand and Five Naira Only"],
    [1_250_000, "One Million, Two Hundred and Fifty Thousand Naira Only"],
    [32_250_000, "Thirty-Two Million, Two Hundred and Fifty Thousand Naira Only"],
    [9_406_250.5, "Nine Million, Four Hundred and Six Thousand, Two Hundred and Fifty Naira and Fifty Kobo Only"],
    [0.07, "Zero Naira and Seven Kobo Only"],
    [1_000_000_000, "One Billion Naira Only"],
    [19.999, "Twenty Naira Only"], // rounded to kobo
  ])("%d", (amount, words) => expect(amountInWords(amount)).toBe(words));

  it("number words and the merge formats", () => {
    expect(numberWords(999_999)).toBe("Nine Hundred and Ninety-Nine Thousand, Nine Hundred and Ninety-Nine");
    const data = { invoice: { total: 1500.5, customer: "ACME logistics LTD", issued: "2026-10-05" } };
    expect(renderMerge("{{invoice.total | words}}", data)).toBe("One Thousand, Five Hundred Naira and Fifty Kobo Only");
    expect(renderMerge("{{invoice.total | usd}} / {{invoice.total | currency}}", data)).toBe("$ 1,500.50 / ₦ 1,500.50");
    expect(renderMerge("{{invoice.customer | title}} – {{invoice.customer | upper}} – {{invoice.customer | lower}}", data)).toBe("Acme Logistics Ltd – ACME LOGISTICS LTD – acme logistics ltd");
    expect(renderMerge('{{invoice.issued | date}} {{invoice.missing | "n/a"}}', data)).toBe("05/10/2026 n/a");
  });
});

describe("conditions", () => {
  const merge = sampleRecord("deals").merge;
  it("compares text ignoring case and separators, numbers as numbers", () => {
    expect(conditionHolds(merge, { field: "paymentType", op: "eq", value: "bank finance" })).toBe(true);
    expect(conditionHolds(merge, { field: "paymentType", op: "eq", value: "BANK_FINANCE" })).toBe(true);
    expect(conditionHolds(merge, { field: "paymentType", op: "ne", value: "Cash" })).toBe(true);
    expect(conditionHolds(merge, { field: "deal.balance", op: "gt", value: "0" })).toBe(true);
    expect(conditionHolds(merge, { field: "balance", op: "lt", value: "1000" })).toBe(false);
    expect(conditionHolds(merge, { field: "total", op: "eq", value: "32250000" })).toBe(true);
    expect(conditionHolds(merge, { field: "nothing", op: "empty", value: "" })).toBe(true);
    expect(conditionHolds(merge, { field: "account.name", op: "notEmpty", value: "" })).toBe(true);
    expect(conditionHolds(merge, { field: "nothing", op: "gt", value: "0" })).toBe(false);
  });

  it("never reaches the prototype chain", () => {
    expect(valueOf(merge, "constructor.name")).toBeUndefined();
    expect(valueOf(merge, "__proto__")).toBeUndefined();
    expect(valueOf(merge, "account.constructor")).toBeUndefined();
  });

  it("a conditional section prints the bank-finance block only for bank finance – not for cash", () => {
    const content = page([{ type: "conditional", field: "paymentType", op: "eq", value: "Bank Finance", html: "<p>BANK FINANCE BLOCK for {{account.name}}</p>" }]);
    expect(render(content, sampleRecord("deals", { paymentType: "Bank Finance" }))).toContain("BANK FINANCE BLOCK for Acme Logistics Ltd");
    expect(render(content, sampleRecord("deals", { paymentType: "Cash" }))).not.toContain("BANK FINANCE BLOCK");
  });
});

describe("compiler", () => {
  it("the letterhead is the one of the record's brand, in the repeating header, in the chosen position", () => {
    const content = page([{ type: "title", text: "TAX INVOICE", showNumber: true, showDates: true }], { letterhead: { show: true, logo: "right", details: "below" }, header: "<p>Header for {{account.name}}</p>", footer: "<p>{{brand.legalEntity}}</p><p>Page {{page}} of {{pages}}</p>" });
    const html = render(content);
    expect(html).toMatch(/<thead><tr><td data-region="header"><header class="lh lh-right lh-below" data-letterhead="DEMO">/);
    expect(html).toContain("Header for Acme Logistics Ltd");
    expect(html).toMatch(/<tfoot><tr><td data-region="footer"><div class="rich pg-foot"><p>Demo Motors Nigeria Ltd<\/p><\/div>/);
    expect(html).not.toContain("{{page}}");
    expect(html).toContain("DEMO-INV-2026-00045");
    expect(html).toContain("<dt>Due date</dt><dd>19/10/2026</dd>");
    // the same template on another brand's record shows that brand – the template names no company
    const other = render(content, sampleRecord("invoices", { brandId: "other" }), OTHER_LETTERHEAD);
    expect(other).toContain('data-letterhead="OTHR"');
    expect(other).toContain("Other Autos Ltd");
    expect(other).not.toContain("Demo Motors");
    expect(render({ ...content, letterhead: { ...content.letterhead, show: false } })).not.toContain("data-letterhead");
  });

  it("the page-number line is taken out of the footer", () => {
    expect(splitFooter("<p>Legal text</p><p>Page {{page}} of {{pages}}</p>")).toEqual({ html: "<p>Legal text</p>", pageLine: "Page {{page}} of {{pages}}" });
    expect(splitFooter('<p style="text-align:right"><strong>{{ page }}</strong>/{{pages}}</p>')).toEqual({ html: "", pageLine: "{{ page }}/{{pages}}" });
    expect(splitFooter("<p>No numbers</p>")).toEqual({ html: "<p>No numbers</p>", pageLine: null });
    expect(compileDoc(page([{ type: "pageBreak" }], { footer: "<p>{{page}}/{{pages}}</p>" }), sampleRecord("invoices"), LETTERHEAD, { printedBy: "x" }).pageLine).toBe("{{page}}/{{pages}}");
  });

  it("line items: chosen columns in the chosen order, serial number, shaded rows; totals and words come from the record", () => {
    expect(pickColumns(linesTable(2), ["sn", "lineTotal", "nothing", "description"]).columns.map((c) => c.label)).toEqual(["S/N", "Line total", "Description"]);
    expect(pickColumns(linesTable(2), ["sn", "lineTotal", "description"]).rows[1]).toEqual(["2", "₦ 25,000.00", "Accessory pack 1"]);
    expect(pickColumns(linesTable(2), []).columns).toHaveLength(5);
    expect(pickColumns(linesTable(2), ["nothing"]).columns).toHaveLength(5); // nothing usable chosen → all columns
    const html = render(page([{ type: "lineItems", columns: ["sn", "description", "lineTotal"], zebra: true }, { type: "totals", words: true }, { type: "rich", html: "<p>In words: {{amountInWords}}</p><p>Typed total: 1</p>" }]));
    expect(html).toContain('<table class="t zebra" data-table="lines"><thead><tr><th class="">S/N</th><th class="">Description</th><th class="r">Line total</th></tr></thead>');
    expect(html).toContain("<span>Total</span><span>₦ 32,250,000.00</span>");
    expect(html).toContain("<strong>Amount in words:</strong> Thirty-Two Million, Two Hundred and Fifty Thousand Naira Only");
    expect(html).toContain("In words: Thirty-Two Million, Two Hundred and Fifty Thousand Naira Only");
  });

  it("parties, payment details, vehicle, repeating section and signatures", () => {
    const html = render(
      page([
        { type: "parties", shipTo: true },
        { type: "payment", terms: "Pay within 14 days of {{invoice.issueDate | date}}." },
        { type: "vehicle" },
        { type: "repeat", list: "payments", title: "Payments", html: "<p>{{row.index}}. {{row.number}} – {{row.total}} ({{account.name}})</p>" },
        { type: "signatures", roles: ["Customer", "Accounts"], stamp: true },
      ]),
    );
    expect(html).toContain("<h3>Bill to</h3><p>Acme Logistics Ltd<br>12 Harbour Street<br>Apapa<br>Lagos<br>+234 800 000 0001<br>accounts@acme.example<br>TIN 12345678-0001</p>");
    expect(html).toContain("<h3>Ship to</h3>");
    expect(html).toContain("<h3>Payment details</h3><p>Demo Bank Plc<br>Account 0000000000</p><p>Pay within 14 days of 05/10/2026.</p>");
    expect(html).toContain("<dt>VIN</dt><dd>DEMO0000000000001</dd>");
    expect(html).toContain("1. DEMO-0001 – ₦ 1,000,000.00 (Acme Logistics Ltd)");
    expect(html).toContain("2. DEMO-0002 – ₦ 2,500,000.00 (Acme Logistics Ltd)");
    expect(html).toContain('<div class="sig stamp">Company stamp</div>');
  });

  it("values of the record are escaped, and braces in data are not merged again", () => {
    const record = sampleRecord("invoices");
    record.merge.account = { ...record.merge.account, name: '<img src=x onerror=alert(1)> {{brand.bankDetails}}' };
    const html = render(page([{ type: "parties", shipTo: false }, { type: "rich", html: "<p>Dear {{account.name}}</p>" }]), record);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; {{brand.bankDetails}}");
    expect(html.match(/Demo Bank Plc/g)).toBeNull(); // no payment block here, and the injected field stayed text
  });
});

describe("restricted CSS", () => {
  it("keeps allow-listed declarations only", () => {
    expect(cleanCss("font-family: georgia; font-size: 11pt; line-height: 1.6; color: #112233")).toEqual({ css: "font-family: Georgia; font-size: 11pt; line-height: 1.6; color: #112233", dropped: [] });
    const bad = cleanCss("position: fixed; background: url(https://evil.example/x.png); font-family: Comic Sans MS; font-size: 40pt; } body { display: none; color: red");
    expect(bad.css).toBe("");
    expect(bad.dropped).toEqual(expect.arrayContaining(["position", "background", "font-family", "font-size", "color"]));
    expect(sheetCss("font-family: Lato; behavior: url(x)")).toBe('font-family: "Lato", Arial, sans-serif');
    expect(sheetCss(null)).toBe("");
  });
});

describe("starters", () => {
  it("ten formats, each for a printable module, with readable merge fields, rendering on the letterhead", () => {
    expect(DOC_STARTERS.map((s) => s.name)).toEqual(["Tax Invoice", "Proforma Invoice", "Sales Order", "Quotation", "Booking Receipt", "Deal Summary / Offer Letter", "Delivery Note & Gate Pass", "Test Drive Indemnity", "Purchase Order", "Customer Statement"]);
    for (const s of DOC_STARTERS) {
      expect(PRINT_MODULE_OPTIONS.some((m) => m.key === s.module), s.key).toBe(true);
      expect(brokenFields(contentSource(s.content)), s.key).toEqual([]);
      const html = render(s.content, sampleRecord(s.module));
      expect(html, s.key).toContain('data-letterhead="DEMO"');
      expect(html, s.key).not.toMatch(/\{\{[^}]*\}\}/); // every merge field resolved or empty
    }
  });
});
