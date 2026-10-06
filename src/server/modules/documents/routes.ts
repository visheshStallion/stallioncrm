/** Route-handler factories shared by /api/v1/quotes, /salesOrders and /invoices. */
import "server-only";
import { apiHandler } from "@/server/api";
import { fieldMask, fieldMaskMany } from "@/server/access/field-mask";
import { BadRequestError } from "@/server/errors";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { requireApiContext } from "@/server/request";
import { DOCS, type DocType } from "./config";
import { documentPdfModel, renderDocumentPdf } from "./pdf";
import { getDocument, listDocuments } from "./queries";
import { createDocument, createQuoteFromDeal, expireQuotes, linkDocument, saveDocument } from "./service";

type Params = { params: Promise<{ id: string }> };

export function listHandlers(type: DocType) {
  return {
    /** GET ?brandId=&regionId=&status=&dealId=&q=&page=&per= – documents in the caller's scope. */
    GET: apiHandler(async (req) => {
      const ctx = await requireApiContext();
      const sp = Object.fromEntries(new URL(req.url).searchParams);
      const paging = parseApiPaging(sp);
      if (type === "quote") await expireQuotes(ctx);
      const linked = sp.linkStatus === "Linked" || sp.linkStatus === "Unlinked" ? sp.linkStatus : undefined;
      const { rows, total } = await listDocuments(ctx, type, { brandId: sp.brandId, regionId: sp.regionId }, { q: sp.q, status: sp.status, dealId: sp.dealId, linked, take: paging.per, skip: paging.skip });
      return Response.json({ data: fieldMaskMany(ctx, DOCS[type].module, rows), meta: listMeta(total, paging) });
    }),
    /**
     * POST – a new draft document (prompt 23): { billTo: { name, … }, lines: [{ description | productId, qty, unitPrice }],
     * brandId?, regionId?, issueDate?, date?, dealId?, accountId?, contactId?, sourceDocumentId?, priceBookId? }.
     * Legacy: a quote body with only { dealId } creates the quote from the deal as before.
     */
    POST: apiHandler(async (req) => {
      const ctx = await requireApiContext();
      const body = (await req.json()) as Record<string, unknown>;
      if (type === "quote" && typeof body.dealId === "string" && !body.billTo && !body.lines) {
        const quote = await createQuoteFromDeal(ctx, body.dealId);
        return Response.json({ data: fieldMask(ctx, DOCS[type].module, await getDocument(ctx, type, quote.id)) }, { status: 201 });
      }
      if (!body || typeof body !== "object") throw new BadRequestError("Send the document as JSON");
      const created = await createDocument(ctx, type, body as never);
      return Response.json({ data: fieldMask(ctx, DOCS[type].module, await getDocument(ctx, type, created.id)) }, { status: 201 });
    }),
  };
}

export function itemHandlers(type: DocType) {
  return {
    /** 404 for missing AND out-of-scope documents. */
    GET: apiHandler<Params>(async (_req, { params }) => {
      const ctx = await requireApiContext();
      return Response.json({ data: fieldMask(ctx, DOCS[type].module, await getDocument(ctx, type, (await params).id)) });
    }),
    /** PATCH { lines, headerDiscountPct, date, terms, notes } – draft documents only; totals are computed server-side. */
    PATCH: apiHandler<Params>(async (req, { params }) => {
      const ctx = await requireApiContext();
      const { id } = await params;
      await saveDocument(ctx, type, id, await req.json());
      return Response.json({ data: fieldMask(ctx, DOCS[type].module, await getDocument(ctx, type, id)) });
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

/** POST …/{id}/link { dealId?, accountId?, contactId?, sourceDocumentId?, refreshBillTo? } – link later (null removes a link). */
export function linkHandler(type: DocType) {
  return apiHandler<Params>(async (req, { params }) => {
    const ctx = await requireApiContext();
    const doc = await linkDocument(ctx, type, (await params).id, await req.json());
    return Response.json({ data: fieldMask(ctx, DOCS[type].module, doc) });
  });
}
