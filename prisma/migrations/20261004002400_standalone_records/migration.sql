-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_dealId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_dealId_fkey";

-- DropForeignKey
ALTER TABLE "SalesOrder" DROP CONSTRAINT "SalesOrder_dealId_fkey";

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "documentRules" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "isStockItem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itemCode" TEXT,
ADD COLUMN     "uom" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billTo" JSONB,
ADD COLUMN     "shipTo" JSONB,
ALTER COLUMN "dealId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "company" TEXT,
ALTER COLUMN "lastName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "billTo" JSONB,
ADD COLUMN     "shipTo" JSONB,
ALTER COLUMN "dealId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "billTo" JSONB,
ADD COLUMN     "shipTo" JSONB,
ALTER COLUMN "dealId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 23 – standalone documents with optional links)
-- ---------------------------------------------------------------------------

-- Brand and region: inherited from the deal WHEN one is linked; a standalone document carries its own (the brand-owned
-- mixin keeps both NOT NULL, so isolation is unchanged). Numbering is unchanged: gap-free per brand / type / year.
CREATE OR REPLACE FUNCTION app_document_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_region text;
  v_prefix text;
  v_type text;
  v_year int;
  v_seq int;
BEGIN
  IF NEW."dealId" IS NOT NULL THEN
    SELECT "brandId", "regionId" INTO v_brand, v_region FROM "Deal" WHERE id = NEW."dealId";
    IF v_brand IS NULL THEN
      RAISE EXCEPTION 'Unknown deal' USING ERRCODE = '23503';
    END IF;
    IF NEW."brandId" IS DISTINCT FROM v_brand OR NEW."regionId" IS DISTINCT FROM v_region THEN
      RAISE EXCEPTION 'A document inherits brand and region from its deal' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_brand := NEW."brandId";

  IF TG_OP = 'INSERT' AND coalesce(NEW."number", '') = '' THEN
    v_type := CASE TG_TABLE_NAME WHEN 'Quote' THEN 'QT' WHEN 'SalesOrder' THEN 'SO' ELSE 'INV' END;
    v_year := extract(year FROM NEW."issueDate")::int;
    INSERT INTO "DocumentCounter" ("brandId", "type", "year", "last") VALUES (v_brand, v_type, v_year, 1)
    ON CONFLICT ("brandId", "type", "year") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
    RETURNING "last" INTO v_seq;
    SELECT coalesce(nullif("docPrefix", ''), code) INTO v_prefix FROM "Brand" WHERE id = v_brand;
    NEW."number" := v_prefix || '-' || v_type || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  ELSIF TG_OP = 'UPDATE' AND NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'Document numbers cannot be changed' USING ERRCODE = '23514';
  ELSIF TG_OP = 'UPDATE' AND NEW."brandId" IS DISTINCT FROM OLD."brandId" THEN
    RAISE EXCEPTION 'The brand of a document cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

-- The source document of a conversion / link must be of the same brand.
CREATE OR REPLACE FUNCTION app_document_source_same_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src text;
BEGIN
  IF NEW."sourceDocumentId" IS NULL OR (TG_OP = 'UPDATE' AND NEW."sourceDocumentId" IS NOT DISTINCT FROM OLD."sourceDocumentId") THEN
    RETURN NEW;
  END IF;
  v_src := coalesce(
    (SELECT "brandId" FROM "Quote" WHERE id = NEW."sourceDocumentId"),
    (SELECT "brandId" FROM "SalesOrder" WHERE id = NEW."sourceDocumentId"));
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Unknown source document' USING ERRCODE = '23503';
  END IF;
  IF v_src IS DISTINCT FROM NEW."brandId" THEN
    RAISE EXCEPTION 'The source document belongs to another brand' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER order_source_same_brand BEFORE INSERT OR UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app_document_source_same_brand();
CREATE TRIGGER invoice_source_same_brand BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION app_document_source_same_brand();

-- Existing documents get their bill-to snapshot from the deal's account / customer, so every document prints the same
-- way whether it is linked or not.
UPDATE "Quote" q SET "billTo" = jsonb_strip_nulls(jsonb_build_object('name', coalesce(a.name, d."customerName"), 'phone', a.phone, 'email', a.email, 'address', a.address, 'city', a.city, 'state', a.state))
  FROM "Deal" d LEFT JOIN "Account" a ON a.id = d."accountId" WHERE d.id = q."dealId" AND q."billTo" IS NULL;
UPDATE "SalesOrder" q SET "billTo" = jsonb_strip_nulls(jsonb_build_object('name', coalesce(a.name, d."customerName"), 'phone', a.phone, 'email', a.email, 'address', a.address, 'city', a.city, 'state', a.state))
  FROM "Deal" d LEFT JOIN "Account" a ON a.id = d."accountId" WHERE d.id = q."dealId" AND q."billTo" IS NULL;
UPDATE "Invoice" q SET "billTo" = jsonb_strip_nulls(jsonb_build_object('name', coalesce(a.name, d."customerName"), 'phone', a.phone, 'email', a.email, 'address', a.address, 'city', a.city, 'state', a.state))
  FROM "Deal" d LEFT JOIN "Account" a ON a.id = d."accountId" WHERE d.id = q."dealId" AND q."billTo" IS NULL;

-- A lead is a person (last name) or a company enquiry (company).
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_name_check" CHECK (coalesce(btrim("lastName"), '') <> '' OR coalesce(btrim("company"), '') <> '');
-- The search index covers company names as well.
DROP INDEX IF EXISTS "Lead_search_trgm";
CREATE INDEX "Lead_search_trgm" ON "Lead" USING gin ((coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("company", '')) gin_trgm_ops);

-- Standard reports: documents without links, and vehicle lines without a stock unit (prompt 23 §5). Idempotent.
CREATE OR REPLACE FUNCTION app_seed_document_reports() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "Report" (id, key, name, description, module, folder, definition, "updatedAt") VALUES
    ('rp_unlinked_docs', 'unlinked-documents-by-brand', 'Unlinked documents by brand', 'Quotes, sales orders and invoices without a deal, account, contact or source document – to follow up.', 'documents', 'GROUP',
     '{"module":"documents","filters":[{"field":"linkStatus","op":"eq","value":"Unlinked"}],"groupBy":[{"field":"brand"},{"field":"docType"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"total"}],"chart":{"type":"bar"}}', now()),
    ('rp_non_stock_lines', 'non-stock-vehicle-lines', 'Non-stock vehicle lines', 'Documents with vehicle lines that are not linked to a stock unit of the brand (free-text VIN).', 'documents', 'GROUP',
     '{"module":"documents","columns":["docType","number","brand","customer","status","nonStockLines","total","issueDate"],"filters":[{"field":"nonStockLines","op":"gt","value":0}],"groupBy":[],"summaries":[],"sort":{"field":"issueDate","dir":"desc"},"chart":{"type":"none"}}', now())
  ON CONFLICT DO NOTHING;
END
$fn$;
SELECT app_seed_document_reports();
