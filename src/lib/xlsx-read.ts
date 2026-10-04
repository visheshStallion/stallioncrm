/**
 * Minimal XLSX reader for the import wizard: the first worksheet as rows of strings. No dependency – an .xlsx
 * file is a ZIP of XML parts (stored or deflated). Formulas are read as their cached values; styles, dates
 * formats and further sheets are ignored (dates arrive as Excel serial numbers and are converted by the
 * importer when the target field is a date). Processed in memory only.
 */
import { inflateRawSync } from "node:zlib";

const MAX_UNZIPPED = 40 * 1024 * 1024;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function entries(buf: Buffer): Entry[] {
  // End of central directory: signature 0x06054b50, searched from the end (comment ≤ 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt .xlsx file");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nameLen), method: buf.readUInt16LE(p + 10), compressedSize: buf.readUInt32LE(p + 20), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("Corrupt .xlsx file");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }).toString("utf8");
  throw new Error("Unsupported compression in .xlsx file");
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
/** Text of an <si> / <is> element: all <t> runs concatenated. */
const text = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join("");

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Rows of the first worksheet (empty trailing cells trimmed, fully empty rows dropped). */
export function readXlsx(bytes: Uint8Array, maxRows = 20_000): string[][] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const all = entries(buf);
  const find = (name: string) => all.find((e) => e.name === name);
  const sheet = find("xl/worksheets/sheet1.xml") ?? all.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheet) throw new Error("The workbook has no worksheet");
  const sharedEntry = find("xl/sharedStrings.xml");
  const shared = sharedEntry ? [...read(buf, sharedEntry).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => text(m[1] ?? "")) : [];

  const rows: string[][] = [];
  const xml = read(buf, sheet);
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const c of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const inner = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = text(inner);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = unescape(v);
      while (row.length < col) row.push("");
      row[col] = value;
      next = col + 1;
    }
    while (row.length && row[row.length - 1] === "") row.pop();
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    if (rows.length > maxRows) throw new Error(`The sheet has more than ${maxRows} rows`);
  }
  return rows;
}

/** Excel serial date (1900 system) → ISO date; null when the value is not a plausible serial. */
export function excelSerialToDate(v: string): string | null {
  if (!/^\d{4,6}(\.\d+)?$/.test(v)) return null;
  const serial = Number(v);
  if (serial < 20_000 || serial > 80_000) return null; // 1954 … 2119
  return new Date(Math.round((serial - 25_569) * 86_400_000)).toISOString().slice(0, 10);
}
