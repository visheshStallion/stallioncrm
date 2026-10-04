import { describe, expect, it } from "vitest";
import { toXlsx, zipStore } from "@/lib/xlsx";
import { REPORT_MODULES } from "@/server/modules/reports/catalog";
import { definitionSchema, resolveRange } from "@/server/modules/reports/definition";

describe("date presets (Africa/Lagos)", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const iso = (r: { from: Date | null; to: Date | null }) => [r.from?.toISOString() ?? null, r.to?.toISOString() ?? null];
  it("resolves months, quarters and years as [from, to) at Lagos midnight", () => {
    expect(iso(resolveRange({ preset: "THIS_MONTH" }, now))).toEqual(["2026-09-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "LAST_MONTH" }, now))).toEqual(["2026-08-31T23:00:00.000Z", "2026-09-30T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "THIS_QUARTER" }, now))).toEqual(["2026-09-30T23:00:00.000Z", "2026-12-31T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "LAST_QUARTER" }, now))).toEqual(["2026-06-30T23:00:00.000Z", "2026-09-30T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "THIS_YEAR" }, now))).toEqual(["2025-12-31T23:00:00.000Z", "2026-12-31T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "LAST_7_DAYS" }, now))).toEqual(["2026-09-27T23:00:00.000Z", "2026-10-04T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "ALL" }, now))).toEqual([null, null]);
    expect(iso(resolveRange(undefined, now))).toEqual([null, null]);
  });
  it("custom ranges include the last day; invalid dates are ignored", () => {
    expect(iso(resolveRange({ preset: "CUSTOM", from: "2026-01-01", to: "2026-01-31" }, now))).toEqual(["2025-12-31T23:00:00.000Z", "2026-01-31T23:00:00.000Z"]);
    expect(iso(resolveRange({ preset: "CUSTOM", from: "01/01/2026", to: "" }, now))).toEqual([null, null]);
  });
  it("just before Lagos midnight UTC is already the next Lagos day / month", () => {
    expect(iso(resolveRange({ preset: "THIS_MONTH" }, new Date("2026-10-31T23:30:00Z")))).toEqual(["2026-10-31T23:00:00.000Z", "2026-11-30T23:00:00.000Z"]);
  });
});

describe("catalog", () => {
  it("has unique field keys per module and never offers contact details", () => {
    for (const m of REPORT_MODULES) {
      const keys = m.fields.map((f) => f.key);
      expect(new Set(keys).size, m.key).toBe(keys.length);
      for (const c of m.defaultColumns) expect(keys, `${m.key} default column ${c}`).toContain(c);
      expect(keys).toContain(m.defaultSort);
      for (const f of m.fields) expect(f.sql.toLowerCase(), `${m.key}.${f.key}`).not.toMatch(/mobile|phone|email|passwordhash|licencenumber|"nin"|"bvn"/);
    }
  });
  it("definitions default sensibly", () => {
    const d = definitionSchema.parse({ module: "deals", groupBy: [{ field: "brand" }] });
    expect(d).toMatchObject({ columns: [], filters: [], summaries: [], chart: { type: "none" } });
    expect(definitionSchema.safeParse({ module: "deals" }).success).toBe(false); // neither columns nor grouping
  });
});

describe("xlsx writer", () => {
  const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
  const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);
  it("writes a valid stored zip (signatures, sizes, central directory)", () => {
    const zip = zipStore([
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "dir/b.txt", data: new TextEncoder().encode("world!") },
    ]);
    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(u32(zip, 14)).toBe(0x3610a686); // crc32("hello")
    expect(u32(zip, 18)).toBe(5);
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(u16(zip, end + 10)).toBe(2);
    expect(u32(zip, u32(zip, end + 16))).toBe(0x02014b50); // central directory starts where the end record says
  });
  it("keeps numbers numeric, escapes text and never writes formulas", () => {
    const text = new TextDecoder().decode(toXlsx("Deals / Q4", ["Name", "Amount"], [["=HYPERLINK(\"http://x\")", 1500000.5], ["A & B <c>", null]]));
    expect(text).toContain('<c r="B2"><v>1500000.5</v></c>');
    expect(text).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;)</t>');
    expect(text).toContain("A &amp; B &lt;c&gt;");
    expect(text).not.toContain("<f>");
    expect(text).toContain('name="Deals   Q4"');
    for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) expect(text).toContain(part);
  });
});
