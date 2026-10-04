/**
 * Paging of the REST API (prompt 13). Lists accept either
 *   • `cursor` + `limit` (1–200): pass `meta.nextCursor` of the previous page back as `cursor`; or
 *   • `page` + `per` (the UI's page sizes) – kept for compatibility.
 * The cursor is opaque to clients. It encodes the position in the caller's scoped, ordered result.
 */
import { BadRequestError } from "@/server/errors";
import { parsePaging } from "@/server/list/filters";

export interface ApiPaging {
  page: number;
  per: number;
  skip: number;
}

const encode = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString("base64url");

export function parseApiPaging(sp: { page?: string; per?: string; cursor?: string; limit?: string }): ApiPaging {
  if (sp.cursor === undefined && sp.limit === undefined) return parsePaging(sp);
  const per = Math.min(Math.max(Math.floor(Number(sp.limit ?? 50)) || 50, 1), 200);
  let skip = 0;
  if (sp.cursor) {
    try {
      skip = Number((JSON.parse(Buffer.from(sp.cursor, "base64url").toString()) as { o?: unknown }).o);
    } catch {
      skip = Number.NaN;
    }
    if (!Number.isInteger(skip) || skip < 0 || skip > 10_000_000) throw new BadRequestError("Invalid cursor");
  }
  return { page: Math.floor(skip / per) + 1, per, skip };
}

export function listMeta(total: number, paging: ApiPaging) {
  const next = paging.skip + paging.per;
  return { total, page: paging.page, per: paging.per, nextCursor: next < total ? encode(next) : null };
}
