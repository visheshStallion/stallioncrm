-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "InvoiceStatus" ADD VALUE 'APPROVED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'SENT';
ALTER TYPE "InvoiceStatus" ADD VALUE 'OVERDUE';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "taxId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customerPoRef" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "exciseDuty" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "formViewId" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "otherCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "salesCommission" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "tinNumber" TEXT,
ADD COLUMN     "voidReason" TEXT;

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written (prompt 26): credit notes follow their invoice (brand, visibility) and are numbered per brand / year
-- ---------------------------------------------------------------------------
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_note_doc ON "CreditNote" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"));

CREATE OR REPLACE FUNCTION app_credit_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_year int;
  v_seq int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Credit notes cannot be changed – issue another one' USING ERRCODE = '23514';
  END IF;
  SELECT "brandId" INTO NEW."brandId" FROM "Invoice" WHERE id = NEW."invoiceId";
  v_year := extract(year FROM NEW."createdAt")::int;
  INSERT INTO "DocumentCounter" ("brandId", "type", "year", "last") VALUES (NEW."brandId", 'CN', v_year, 1)
  ON CONFLICT ("brandId", "type", "year") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
  RETURNING "last" INTO v_seq;
  SELECT coalesce(nullif("docPrefix", ''), code) INTO v_prefix FROM "Brand" WHERE id = NEW."brandId";
  NEW."number" := v_prefix || '-CN-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  RETURN NEW;
END
$$;
CREATE TRIGGER credit_note_number BEFORE INSERT OR UPDATE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION app_credit_note();

-- existing invoices: a subject from the customer until someone gives them one; the Account TIN from earlier snapshots
UPDATE "Invoice" SET "subject" = coalesce(nullif("billTo"->>'name', ''), "number") WHERE "subject" IS NULL;
UPDATE "Invoice" SET "tinNumber" = nullif("billTo"->>'taxId', '') WHERE "tinNumber" IS NULL;
