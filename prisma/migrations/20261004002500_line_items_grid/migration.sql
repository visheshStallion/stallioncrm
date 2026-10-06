-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoicedQty" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceLineId" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vins" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "documentTaxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "headerDiscountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "headerDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "documentTaxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "headerDiscountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "headerDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "documentTaxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "headerDiscountType" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "headerDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0;



-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 24 – Ordered Items grid): existing lines get the new columns from their old ones.
-- ---------------------------------------------------------------------------
UPDATE "DocumentLine" SET
  "amount" = round(qty * "unitPrice", 2),
  "discountType" = 'PERCENT',
  "discountValue" = "discountPct",
  "discountAmount" = round(qty * "unitPrice", 2) - "lineTotal",
  "taxes" = CASE WHEN "taxRate" > 0 THEN jsonb_build_array(jsonb_build_object('name', 'VAT', 'rate', "taxRate", 'amount', round("lineTotal" * "taxRate" / 100, 2))) ELSE '[]'::jsonb END,
  "taxAmount" = round("lineTotal" * "taxRate" / 100, 2),
  "total" = "lineTotal" + round("lineTotal" * "taxRate" / 100, 2),
  "vins" = CASE WHEN vin IS NOT NULL THEN jsonb_build_array(vin) ELSE '[]'::jsonb END;
UPDATE "Quote" SET "headerDiscountValue" = "headerDiscountPct";
UPDATE "SalesOrder" SET "headerDiscountValue" = "headerDiscountPct";
UPDATE "Invoice" SET "headerDiscountValue" = "headerDiscountPct";
