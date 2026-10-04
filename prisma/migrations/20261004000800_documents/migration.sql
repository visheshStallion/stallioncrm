-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ALLOCATED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bankDetails" TEXT,
ADD COLUMN     "discountApprovalPct" DECIMAL(5,2) NOT NULL DEFAULT 3,
ADD COLUMN     "discountEscalationPct" DECIMAL(5,2) NOT NULL DEFAULT 7,
ADD COLUMN     "documentTerms" TEXT;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "dealId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "issueDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "headerDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "priceBookId" TEXT,
    "sourceDocumentId" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "dealId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "issueDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "headerDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "priceBookId" TEXT,
    "sourceDocumentId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedDelivery" DATE,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "dealId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "issueDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "headerDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "priceBookId" TEXT,
    "sourceDocumentId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" DATE,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT,
    "salesOrderId" TEXT,
    "invoiceId" TEXT,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "vin" TEXT,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("brandId","type","year")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "level" INTEGER NOT NULL DEFAULT 1,
    "approverId" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_dealId_idx" ON "Quote"("dealId");

-- CreateIndex
CREATE INDEX "Quote_brandId_regionId_idx" ON "Quote"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Quote_ownerId_idx" ON "Quote"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_number_key" ON "SalesOrder"("number");

-- CreateIndex
CREATE INDEX "SalesOrder_dealId_idx" ON "SalesOrder"("dealId");

-- CreateIndex
CREATE INDEX "SalesOrder_brandId_regionId_idx" ON "SalesOrder"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "SalesOrder_ownerId_idx" ON "SalesOrder"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_dealId_idx" ON "Invoice"("dealId");

-- CreateIndex
CREATE INDEX "Invoice_brandId_regionId_idx" ON "Invoice"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Invoice_ownerId_idx" ON "Invoice"("ownerId");

-- CreateIndex
CREATE INDEX "DocumentLine_quoteId_idx" ON "DocumentLine"("quoteId");

-- CreateIndex
CREATE INDEX "DocumentLine_salesOrderId_idx" ON "DocumentLine"("salesOrderId");

-- CreateIndex
CREATE INDEX "DocumentLine_invoiceId_idx" ON "DocumentLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entity_entityId_idx" ON "ApprovalRequest"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverId_status_idx" ON "ApprovalRequest"("approverId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_brandId_regionId_idx" ON "ApprovalRequest"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "DomainEvent_processedAt_createdAt_idx" ON "DomainEvent"("processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Documents are brand-owned (RLS) and linked to customers.
-- ---------------------------------------------------------------------------
SELECT app_enable_brand_rls('"Quote"');
SELECT app_enable_brand_rls('"SalesOrder"');
SELECT app_enable_brand_rls('"Invoice"');
SELECT app_enable_brand_rls('"ApprovalRequest"');
SELECT app_track_customer_links('"Quote"');
SELECT app_track_customer_links('"SalesOrder"');
SELECT app_track_customer_links('"Invoice"');

-- Lines and payments follow their document (the document's RLS applies inside the subqueries).
ALTER TABLE "DocumentLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_line ON "DocumentLine" FOR ALL TO stallion_rls
  USING (
    EXISTS (SELECT 1 FROM "Quote" q WHERE q.id = "quoteId")
    OR EXISTS (SELECT 1 FROM "SalesOrder" o WHERE o.id = "salesOrderId")
    OR EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"))
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Quote" q WHERE q.id = "quoteId")
    OR EXISTS (SELECT 1 FROM "SalesOrder" o WHERE o.id = "salesOrderId")
    OR EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"));
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_one_parent"
  CHECK (num_nonnulls("quoteId", "salesOrderId", "invoiceId") = 1);

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_doc ON "Payment" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"));

-- System-only tables.
REVOKE ALL ON "DocumentCounter" FROM stallion_rls;
REVOKE ALL ON "DomainEvent" FROM stallion_rls;

-- ---------------------------------------------------------------------------
-- Brand and region are inherited from the deal; numbering is gap-free per brand / type / year.
-- Both run in the same transaction as the INSERT, so a failed insert never consumes a number.
-- ---------------------------------------------------------------------------
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
  SELECT "brandId", "regionId" INTO v_brand, v_region FROM "Deal" WHERE id = NEW."dealId";
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'Unknown deal' USING ERRCODE = '23503';
  END IF;
  IF NEW."brandId" IS DISTINCT FROM v_brand OR NEW."regionId" IS DISTINCT FROM v_region THEN
    RAISE EXCEPTION 'A document inherits brand and region from its deal' USING ERRCODE = '23514';
  END IF;

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
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER quote_defaults BEFORE INSERT OR UPDATE ON "Quote" FOR EACH ROW EXECUTE FUNCTION app_document_defaults();
CREATE TRIGGER order_defaults BEFORE INSERT OR UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app_document_defaults();
CREATE TRIGGER invoice_defaults BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION app_document_defaults();

-- One accepted quote per deal.
CREATE UNIQUE INDEX "Quote_one_accepted_per_deal" ON "Quote" ("dealId") WHERE status = 'ACCEPTED' AND "deletedAt" IS NULL;

-- A line may only reference a product of its document's brand.
CREATE OR REPLACE FUNCTION app_line_same_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc text;
  v_product text;
BEGIN
  IF NEW."productId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "brandId" INTO v_product FROM "Product" WHERE id = NEW."productId";
  v_doc := coalesce(
    (SELECT "brandId" FROM "Quote" WHERE id = NEW."quoteId"),
    (SELECT "brandId" FROM "SalesOrder" WHERE id = NEW."salesOrderId"),
    (SELECT "brandId" FROM "Invoice" WHERE id = NEW."invoiceId"));
  IF v_product IS DISTINCT FROM v_doc THEN
    RAISE EXCEPTION 'The product belongs to another brand' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER line_same_brand BEFORE INSERT OR UPDATE ON "DocumentLine"
FOR EACH ROW EXECUTE FUNCTION app_line_same_brand();

-- Sales profiles: quotes / orders already granted; management approves. Nothing to change in profiles here.
