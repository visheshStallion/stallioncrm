/** Route-handler factories shared by /api/v1/quotes, /salesOrders and /invoices. */
import "server-only";
import { apiHandler } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { parsePaging } from "@/server/list/filters";
import { requireApiContext } from "@/server/request";
import type { DocType } from "./config";
import { documentPdfModel, renderDocumentPdf } from "./pdf";
import { getDocument, listDocuments } from "./queries";
import { createQuoteFromDeal, expireQuotes, saveDocument } from "./service";

type Params = { params: Promise<{ id: string }> };

export function listHandlers(type: DocType) {
  return {
    /** GET ?brandId=&regionId=&status=&dealId=&q=&page=&per= – documents in the caller's scope. */
    GET: apiHandler(async (req) => {
      const ctx = await requireApiContext();
      const sp = Object.fromEntries(new URL(req.url).searchParams);
      const paging = parsePaging(sp);
      if (type === "quote") await expireQuotes(ctx);
      const { rows, total } = await listDocuments(ctx, type, { brandId: sp.brandId, regionId: sp.regionId }, { q: sp.q, status: sp.status, dealId: sp.dealId, take: paging.per, skip: paging.skip });
      return Response.json({ data: rows, meta: { total, page: paging.page, per: paging.per } });
    }),
    /** POST { dealId } – new draft quote for a deal (orders and invoices are created by conversion). */
    POST: apiHandler(async (req) => {
      const ctx = await requireApiContext();
      if (type !== "quote") throw new BadRequestError("Sales orders and invoices are created by converting the previous document");
      const { dealId } = (await req.json()) as { dealId?: string };
      if (!dealId) throw new BadRequestError("dealId is required");
      const quote = await createQuoteFromDeal(ctx, dealId);
      return Response.json({ data: await getDocument(ctx, type, quote.id) }, { status: 201 });
    }),
  };
}

export function itemHandlers(type: DocType) {
  return {
    /** 404 for missing AND out-of-scope documents. */
    GET: apiHandler<Params>(async (_req, { params }) => {
      const ctx = await requireApiContext();
      return Response.json({ data: await getDocument(ctx, type, (await params).id) });
    }),
    /** PATCH { lines, headerDiscountPct, date, terms, notes } – draft documents only; totals are computed server-side. */
    PATCH: apiHandler<Params>(async (req, { params }) => {
      const ctx = await requireApiContext();
      const { id } = await params;
      await saveDocument(ctx, type, id, await req.json());
      return Response.json({ data: await getDocument(ctx, type, id) });
    }),
  };
}

/** GET …/pdf – the document as PDF on the brand's template (404 when the caller cannot see the document). */
export function pdfHandler(type: DocType) {
  return apiHandler<Params>(async (_req, { params }) => {
    const ctx = await requireApiContext();
    const model = await documentPdfModel(ctx, type, (await params).id);
    const bytes = await renderDocumentPdf(model);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${model.doc.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
