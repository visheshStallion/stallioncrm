import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { clearSetupCaches } from "@/server/db/setup-store";
import { createQuoteFromDeal } from "@/server/modules/documents/service";
import { chromiumPdf, pageCount } from "@/server/modules/print/pdf";
import * as print from "@/server/modules/print/service";
import { saveSetting } from "@/server/modules/setup/service";
import { ctxFor, ids, unsafeDb } from "./helpers";

/**
 * Print engine (prompt 20 Part C): the letterhead is always the record's brand, another brand's record cannot be
 * printed, masked fields print masked, customer lists need the export permission, every print is audited.
 */
let admin: AccessContext;
let md: AccessContext;
let hmnlExec: AccessContext;
let snmnlExec: AccessContext;
let multiExec: AccessContext; // HMNL + SNMNL
let bmHmnl: AccessContext;
let ba: AccessContext; // Brand Admin of HMNL
let id: Awaited<ReturnType<typeof ids>>;
let hmnlDeal: { id: string; name: string };
let snmnlDeal: { id: string; name: string };

beforeAll(async () => {
  [admin, md, hmnlExec, snmnlExec, multiExec, bmHmnl, ba] = (await Promise.all(["admin", "md", "exec.hmnl.1", "exec.snmnl.1", "exec.multi.1", "bm.hmnl", "ba.hmnl"].map(ctxFor))) as AccessContext[] as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
  hmnlDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), region: { name: "Lagos" } }, select: { id: true, name: true } });
  snmnlDeal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("SNMNL"), region: { name: "Lagos" } }, select: { id: true, name: true } });
  await unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { legalEntity: "Hyundai Motors Nigeria Ltd", rcNumber: "RC 123456", address: "1 Marina Road\nLagos", phone: "+234 1 000 0000", vatNumber: "VAT-001", footerText: "An HMNL company" } });
  await unsafeDb.brand.update({ where: { id: id.brand("SNMNL") }, data: { legalEntity: "Stallion Nissan Motors Nigeria Ltd" } });
});

/** A quote of an open HMNL deal (the seed has deals but no documents). */
async function hmnlQuote(): Promise<{ id: string }> {
  const existing = await unsafeDb.quote.findFirst({ where: { brandId: id.brand("HMNL") }, select: { id: true } });
  if (existing) return existing;
  const deal = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), stage: { type: "OPEN" }, deletedAt: null }, select: { id: true } });
  return createQuoteFromDeal(admin, deal.id);
}

const letterheadOf = (html: string) => [...html.matchAll(/data-letterhead="([^"]+)"/g)].map((m) => m[1]);

describe("letterhead", () => {
  it("an HMNL deal always prints on the HMNL letterhead – asking for SNMNL changes nothing", async () => {
    const { html } = await print.renderPrintHtml(multiExec, { module: "deals", recordIds: [hmnlDeal.id], via: "preview" });
    expect(letterheadOf(html)).toEqual(["HMNL"]);
    expect(html).toContain("Hyundai Motors Nigeria Ltd");
    expect(html).toContain("RC RC 123456");
    expect(html).toContain("An HMNL company");
    expect(html).toContain(hmnlDeal.name.replace(/&/g, "&amp;"));

    const swapped = await print.renderPrintHtml(multiExec, { module: "deals", recordIds: [hmnlDeal.id], companyBrandId: id.brand("SNMNL"), via: "preview" });
    expect(letterheadOf(swapped.html)).toEqual(["HMNL"]);
    expect(swapped.html).not.toContain("Stallion Nissan Motors Nigeria Ltd");
    // …and an SNMNL deal of the same user prints as SNMNL
    const other = await print.renderPrintHtml(multiExec, { module: "deals", recordIds: [snmnlDeal.id], via: "preview" });
    expect(letterheadOf(other.html)).toEqual(["SNMNL"]);
  });

  it("shared customers: 'Print as company' offers only the user's brands; another brand or the group is a 404", async () => {
    const account = await unsafeDb.account.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    expect((await print.companyOptions(hmnlExec)).map((c) => c.label)).toEqual(["HMNL – Hyundai Motors Nigeria Ltd"]);
    expect((await print.companyOptions(multiExec)).map((c) => c.label.slice(0, 5).trim())).toEqual(["HMNL", "SNMNL"]);
    expect((await print.companyOptions(md)).at(-1)).toEqual({ id: "group", label: "Group letterhead" });

    const asHmnl = await print.renderPrintHtml(hmnlExec, { module: "accounts", recordIds: [account.id], via: "preview" });
    expect(letterheadOf(asHmnl.html)).toEqual(["HMNL"]);
    await expect(print.renderPrintHtml(hmnlExec, { module: "accounts", recordIds: [account.id], companyBrandId: id.brand("SNMNL"), via: "preview" })).rejects.toThrow(/not found/i);
    await expect(print.renderPrintHtml(hmnlExec, { module: "accounts", recordIds: [account.id], companyBrandId: "group", via: "preview" })).rejects.toThrow(/not found/i);
    const asSnmnl = await print.renderPrintHtml(multiExec, { module: "accounts", recordIds: [account.id], companyBrandId: id.brand("SNMNL"), via: "preview" });
    expect(letterheadOf(asSnmnl.html)).toEqual(["SNMNL"]);
    const asGroup = await print.renderPrintHtml(md, { module: "accounts", recordIds: [account.id], companyBrandId: "group", via: "preview" });
    expect(letterheadOf(asGroup.html)).toEqual(["GROUP"]);
  });

  it("only administrators and the brand's own Brand Admin edit a letterhead", async () => {
    await print.saveLetterhead(ba, id.brand("HMNL"), { legalEntity: "Hyundai Motors Nigeria Ltd", rcNumber: "654321", address: "2 Marina", phone: null, contactEmail: "", website: "hmnl.example", vatNumber: null, bankDetails: null, color: "#1d4ed8", footerText: null, copyWatermark: true });
    await expect(print.saveLetterhead(ba, id.brand("SNMNL"), { legalEntity: "Hacked", rcNumber: null, address: null, phone: null, contactEmail: "", website: null, vatNumber: null, bankDetails: null, color: null, footerText: null, copyWatermark: false })).rejects.toThrow(/not found/i);
    await expect(print.letterheadForEdit(bmHmnl, id.brand("HMNL"))).rejects.toThrow(/not found/i);
    expect((await print.letterheadBrands(ba)).map((b) => b.code)).toEqual(["HMNL"]);
    await expect(print.saveLetterheadLogo(ba, id.brand("HMNL"), { bytes: new Uint8Array(Buffer.from("<svg onload=alert(1)></svg>")) as Uint8Array<ArrayBuffer>, type: "image/svg+xml" })).rejects.toThrow(/script/);
    await expect(print.saveLetterheadLogo(ba, id.brand("HMNL"), { bytes: new Uint8Array(1024 * 1024 + 1) as Uint8Array<ArrayBuffer>, type: "image/png" })).rejects.toThrow(/1 MB/);
    expect((await unsafeDb.brand.findUniqueOrThrow({ where: { id: id.brand("SNMNL") } })).legalEntity).toBe("Stallion Nissan Motors Nigeria Ltd");
  });
});

describe("access", () => {
  it("an HMNL exec cannot print or PDF an SNMNL record – 404, and nothing is rendered or audited", async () => {
    const before = await unsafeDb.auditLog.count({ where: { entity: "Print" } });
    await expect(print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [snmnlDeal.id], via: "preview" })).rejects.toThrow(/not found/i);
    await expect(print.renderPrintPdf(hmnlExec, { module: "deals", recordIds: [snmnlDeal.id], via: "pdf" })).rejects.toThrow(/not found/i);
    await expect(print.renderPrintHtml(hmnlExec, { module: "nothing", recordIds: [snmnlDeal.id], via: "preview" })).rejects.toThrow(/not found/i);
    // bulk: one id of another brand fails the whole request – nothing is skipped silently
    await expect(print.renderPrintPdf(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id, snmnlDeal.id], via: "bulk" })).rejects.toThrow(/not found/i);
    expect(await unsafeDb.auditLog.count({ where: { entity: "Print" } })).toBe(before);
  });

  it("masked and hidden fields print masked and hidden", async () => {
    const profile = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Sales Exec" } });
    const plain = await print.loadPrintRecord(hmnlExec, "deals", hmnlDeal.id);
    const amount = plain.fields.find((f) => f.key === "amount")!.value;
    expect(amount).toMatch(/₦/);
    await unsafeDb.profile.update({ where: { id: profile.id }, data: { fieldPermissions: { deals: { amount: "hidden", customerName: "masked" } } } });
    const exec = await ctxFor("exec.hmnl.1");
    const masked = await print.loadPrintRecord(exec, "deals", hmnlDeal.id);
    expect(masked.fields.find((f) => f.key === "amount")?.value ?? "").toBe("");
    const { html } = await print.renderPrintHtml(exec, { module: "deals", recordIds: [hmnlDeal.id], via: "preview" });
    expect(html).not.toContain(amount);
    const name = plain.fields.find((f) => f.key === "customerName")?.value;
    if (name) {
      expect(html).not.toContain(`>${name}<`);
      expect(masked.fields.find((f) => f.key === "customerName")!.value).toContain("*");
    }
    await unsafeDb.profile.update({ where: { id: profile.id }, data: { fieldPermissions: {} } });
  });

  it("printing a customer list needs the export permission; a mixed-brand list goes on the group letterhead with a brand column", async () => {
    const leads = await unsafeDb.lead.findMany({ where: { brandId: id.brand("HMNL"), region: { name: "Lagos" }, deletedAt: null }, take: 3, select: { id: true } });
    await expect(print.renderListPrint(hmnlExec, { module: "leads", ids: leads.map((l) => l.id), format: "html" })).rejects.toThrow(/export permission/);
    await expect(print.renderPrintHtml(hmnlExec, { module: "leads", recordIds: leads.map((l) => l.id), via: "bulk" })).rejects.toThrow(/export permission/);
    const one = await print.renderPrintHtml(hmnlExec, { module: "leads", recordIds: [leads[0]!.id], via: "preview" }); // a single record only needs read
    expect(letterheadOf(one.html)).toEqual(["HMNL"]);
    const list = await print.renderListPrint(bmHmnl, { module: "leads", ids: leads.map((l) => l.id), format: "html" });
    expect(letterheadOf(list.html)).toEqual(["HMNL"]);
    expect(list.html).toContain("3 record(s)");

    const deals = [hmnlDeal.id, snmnlDeal.id];
    const mixed = await print.renderListPrint(md, { module: "deals", ids: deals, format: "html" });
    expect(letterheadOf(mixed.html)).toEqual(["GROUP"]);
    expect(mixed.html).toMatch(/<th class="">Brand<\/th>/);
    expect(mixed.html).toContain("2 brands");
    // a user of both brands, but not of all: still one of their own brands' letterheads, never the group's
    const two = await print.renderListPrint(multiExec, { module: "deals", ids: deals, format: "html" });
    expect(["HMNL", "SNMNL"]).toContain(letterheadOf(two.html)[0]);
    await expect(print.renderListPrint(hmnlExec, { module: "deals", ids: deals, format: "html" })).rejects.toThrow(/not found/i);
  });

  it("the list watermark of a profile is applied", async () => {
    await saveSetting(admin, "printPolicy", { watermarkProfileIds: [bmHmnl.profile.id] });
    clearSetupCaches();
    const list = await print.renderListPrint(bmHmnl, { module: "deals", ids: [hmnlDeal.id], format: "html" });
    expect(list.html).toMatch(/class="wm"[^>]*><span>Internal – Bola Hassan – /);
    await saveSetting(admin, "printPolicy", { watermarkProfileIds: [] });
    clearSetupCaches();
  });
});

describe("templates", () => {
  it("merge fields, formats and fallbacks render; a page break splits the sheet; unsafe HTML is removed", async () => {
    const layout = print.cleanLayout({
      blocks: [
        { type: "letterhead" },
        { type: "title", text: "OFFER {{deal.name | upper}}" },
        { type: "richText", html: '<p>Dear {{contact.firstName | "Customer"}}, your {{brand.legalEntity}} offer of <strong>{{deal.amount | currency}}</strong>.</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">x</a><iframe src="https://evil.example"></iframe>' },
        { type: "pageBreak" },
        { type: "fields", columns: 2, fields: ["name", "amount", "nosuchfield"] },
        { type: "signatures", roles: ["Customer", "Sales Executive"] },
        { type: "qr", value: "url" },
      ],
    });
    const rich = layout.blocks[2] as { html: string };
    expect(rich.html).not.toMatch(/script|onerror|javascript:|iframe/i);
    const tpl = await print.createTemplate(admin, { module: "deals", name: "Offer letter", brandId: id.brand("HMNL"), paper: "A4", orientation: "portrait", layout });
    await expect(print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], templateId: tpl.id, via: "preview" })).rejects.toThrow(/not found/i); // not published yet
    expect(await print.publishTemplate(admin, tpl.id)).toBe(1);

    const { html } = await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], templateId: tpl.id, via: "preview" });
    expect(html).toContain(`OFFER ${hmnlDeal.name.toUpperCase().replace(/&/g, "&amp;")}`);
    expect(html).toContain("Hyundai Motors Nigeria Ltd offer of <strong>₦ ");
    expect(html).toMatch(/Dear [^,{]+,/);
    expect(html).toContain('<div class="break"></div>');
    expect(html).toContain("<svg"); // the QR code
    expect(html).not.toContain("nosuchfield");
    // an HMNL template is not offered for, and cannot be used with, an SNMNL record
    expect((await print.templateChoices(multiExec, await print.loadPrintRecord(multiExec, "deals", snmnlDeal.id))).map((t) => t.name)).not.toContain("Offer letter");
    await expect(print.renderPrintHtml(multiExec, { module: "deals", recordIds: [snmnlDeal.id], templateId: tpl.id, via: "preview" })).rejects.toThrow(/not found/i);
    expect((await print.templateChoices(hmnlExec, await print.loadPrintRecord(hmnlExec, "deals", hmnlDeal.id))).map((t) => t.name)).toEqual(expect.arrayContaining(["Offer letter", "Standard", "Booking receipt"]));
  });

  it("versions: a draft does not change what prints; publish does; an earlier version can be restored; default per brand", async () => {
    const tpl = await unsafeDb.printTemplate.findFirstOrThrow({ where: { name: "Offer letter" } });
    await print.saveTemplateDraft(admin, tpl.id, { name: "Offer letter", paper: "A4", orientation: "portrait", layout: { blocks: [{ type: "letterhead" }, { type: "title", text: "SECOND VERSION" }] } });
    const still = await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], templateId: tpl.id, via: "preview" });
    expect(still.html).not.toContain("SECOND VERSION");
    expect(await print.publishTemplate(admin, tpl.id)).toBe(2);
    await print.setTemplateFlags(admin, tpl.id, { isDefault: true });
    const byDefault = await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], via: "preview" });
    expect(byDefault.html).toContain("SECOND VERSION");
    expect(byDefault.prepared.template.name).toBe("Offer letter");
    // the default of HMNL does not apply to SNMNL
    expect((await print.renderPrintHtml(multiExec, { module: "deals", recordIds: [snmnlDeal.id], via: "preview" })).html).not.toContain("SECOND VERSION");
    await print.revertTemplate(admin, tpl.id, 1);
    expect(await print.publishTemplate(admin, tpl.id)).toBe(3);
    expect((await print.renderPrintHtml(hmnlExec, { module: "deals", recordIds: [hmnlDeal.id], via: "preview" })).html).toContain("OFFER ");
    await print.setTemplateFlags(admin, tpl.id, { isDefault: false });
  });

  it("a Brand Admin designs for the own brand only; all-brand templates are for administrators", async () => {
    const layout = { blocks: [{ type: "letterhead" }, { type: "title", text: "X" }] };
    const own = await print.createTemplate(ba, { module: "deals", name: "HMNL by brand admin", brandId: id.brand("HMNL"), paper: "A4", orientation: "portrait", layout });
    await expect(print.createTemplate(ba, { module: "deals", name: "Other brand", brandId: id.brand("SNMNL"), paper: "A4", orientation: "portrait", layout })).rejects.toThrow(/not found/i);
    await expect(print.createTemplate(ba, { module: "deals", name: "All brands", brandId: null, paper: "A4", orientation: "portrait", layout })).rejects.toThrow(/administrators/);
    await expect(print.createTemplate(hmnlExec, { module: "deals", name: "Nope", brandId: id.brand("HMNL"), paper: "A4", orientation: "portrait", layout })).rejects.toThrow(/not found/i);
    const snmnl = await print.createTemplate(admin, { module: "deals", name: "SNMNL only", brandId: id.brand("SNMNL"), paper: "A4", orientation: "portrait", layout });
    await expect(print.designerTemplate(ba, snmnl.id)).rejects.toThrow(/not found/i);
    await expect(print.deleteTemplate(ba, snmnl.id)).rejects.toThrow(/not found/i);
    expect((await print.designerTemplates(ba)).map((t) => t.name)).not.toContain("SNMNL only");
    await print.deleteTemplate(ba, own.id);
  });
});

describe("PDF", () => {
  it("a document with many line items spans pages, repeats the table header, and counts its pages", async () => {
    const quote = await hmnlQuote();
    const product = await unsafeDb.product.findFirstOrThrow({ where: { brandId: id.brand("HMNL") }, select: { id: true, name: true } });
    await unsafeDb.documentLine.createMany({ data: Array.from({ length: 90 }, (_, i) => ({ quoteId: quote.id, productId: product.id, description: `Extra line ${i + 1} ${product.name}`, qty: 1, unitPrice: 1000, lineTotal: 1000, position: 100 + i })) });

    process.env.PRINT_PDF_ENGINE = "basic";
    const pdf = await print.renderPrintPdf(admin, { module: "quotes", recordIds: [quote.id], via: "pdf" });
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.engine).toBe("basic");
    expect(pdf.pages).toBeGreaterThanOrEqual(3);
    expect(pdf.fileName).toMatch(/^Quotation-.*\.pdf$/);

    const { html } = await print.renderPrintHtml(admin, { module: "quotes", recordIds: [quote.id], via: "preview" });
    expect(html).toContain("<thead>"); // table-header-group repeats the header on every printed page
    expect(html).toContain("Extra line 90");
    expect(html).toMatch(/class="totals"/);
    delete process.env.PRINT_PDF_ENGINE;

    // the same document through headless Chromium, when one is available on this machine
    const chrome = await chromiumPdf(html, { paper: "A4", orientation: "portrait" });
    if (chrome) expect(await pageCount(chrome)).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("documents print COPY after their first print when the brand asks for it; every print is audited", async () => {
    process.env.PRINT_PDF_ENGINE = "basic";
    const doc = { module: "quotes", id: (await hmnlQuote()).id };
    await unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { copyWatermark: true } });
    const before = await unsafeDb.auditLog.count({ where: { entity: "Print", entityId: `${doc.module}:${doc.id}` } });
    const first = await print.renderPrintHtml(bmHmnl, { module: doc.module, recordIds: [doc.id], via: "pdf" });
    if (before === 0) expect(first.html).not.toContain('class="wm"');
    const second = await print.renderPrintHtml(bmHmnl, { module: doc.module, recordIds: [doc.id], via: "pdf" });
    expect(second.html).toMatch(/class="wm"[^>]*><span>COPY<\/span>/);
    const pdf = await print.renderPrintPdf(bmHmnl, { module: doc.module, recordIds: [doc.id], via: "pdf" });

    const entries = await unsafeDb.auditLog.findMany({ where: { entity: "Print", entityId: `${doc.module}:${doc.id}` }, orderBy: { at: "asc" } });
    expect(entries.length).toBe(before + 3);
    const last = entries.at(-1)!;
    expect(last.userId).toBe(bmHmnl.userId);
    expect(last.action).toBe("EXPORT");
    expect(last.brandId).toBe(id.brand("HMNL"));
    expect(last.after).toMatchObject({ module: doc.module, via: "pdf", letterhead: "HMNL", pages: pdf.pages, engine: "basic" });
    expect((last.after as { template: string }).template).toBeTruthy();
    delete process.env.PRINT_PDF_ENGINE;
  });

  it("every printable module renders for an administrator", async () => {
    process.env.PRINT_PDF_ENGINE = "basic";
    for (const mod of print.PRINT_MODULES) {
      const sample = await print.sampleRecord(admin, mod.key);
      if (!sample) continue;
      const { html } = await print.renderPrintHtml(admin, { module: mod.key, recordIds: [sample.id], via: "preview" }, { audited: false });
      expect(html, mod.key).toContain("data-letterhead=");
      const pdf = await print.renderPrintPdf(admin, { module: mod.key, recordIds: [sample.id], via: "pdf" });
      expect(pdf.pages, mod.key).toBeGreaterThanOrEqual(1);
    }
    delete process.env.PRINT_PDF_ENGINE;
  }, 120_000);
});
