/** Price book rules (prompt 05) – pure functions, unit-tested. Dates are whole days (UTC). */

export interface BookLike {
  id: string;
  brandId: string;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  isDefault: boolean;
}

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Is the book valid on `date` (inclusive, open-ended when validTo is null)? */
export function validOn(book: Pick<BookLike, "validFrom" | "validTo" | "active">, date: Date): boolean {
  const t = day(date);
  return book.active && day(book.validFrom) <= t && (book.validTo === null || t <= day(book.validTo));
}

/** Do two validity ranges share at least one day? */
export function rangesOverlap(a: Pick<BookLike, "validFrom" | "validTo">, b: Pick<BookLike, "validFrom" | "validTo">): boolean {
  const aEnd = a.validTo === null ? Infinity : day(a.validTo);
  const bEnd = b.validTo === null ? Infinity : day(b.validTo);
  return day(a.validFrom) <= bEnd && day(b.validFrom) <= aEnd;
}

/** Other active DEFAULT books of the same brand whose validity overlaps `book` (must be empty to save). */
export function overlappingDefaults<T extends BookLike>(book: BookLike, others: T[]): T[] {
  if (!book.isDefault || !book.active) return [];
  return others.filter((o) => o.id !== book.id && o.brandId === book.brandId && o.isDefault && o.active && rangesOverlap(book, o));
}

/** The brand's default active price book for a date (latest validFrom wins if several were ever allowed). */
export function defaultBookFor<T extends BookLike>(books: T[], brandId: string, date: Date): T | null {
  return (
    books
      .filter((b) => b.brandId === brandId && b.isDefault && validOn(b, date))
      .sort((a, b) => day(b.validFrom) - day(a.validFrom))[0] ?? null
  );
}

export interface ResolvedPrice {
  price: number | null;
  source: "priceBook" | "listPrice" | "none";
  priceBookId: string | null;
  maxDiscountPct: number | null;
  taxRatePct: number;
  /** price × (1 + tax) */
  gross: number | null;
}

export function resolve(
  product: { listPrice: number | null; taxRatePct: number },
  entry: { price: number; maxDiscountPct: number | null; priceBookId: string } | null,
): ResolvedPrice {
  const price = entry ? entry.price : product.listPrice;
  return {
    price,
    source: entry ? "priceBook" : product.listPrice !== null ? "listPrice" : "none",
    priceBookId: entry?.priceBookId ?? null,
    maxDiscountPct: entry?.maxDiscountPct ?? null,
    taxRatePct: product.taxRatePct,
    gross: price === null ? null : Math.round(price * (1 + product.taxRatePct / 100) * 100) / 100,
  };
}
