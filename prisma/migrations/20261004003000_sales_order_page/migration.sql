-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "customerNo" TEXT,
ADD COLUMN     "customerPoRef" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "exciseDuty" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "formViewId" TEXT,
ADD COLUMN     "otherCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pending" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "salesCommission" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "tinNumber" TEXT;


-- Hand-written: existing orders take subject, phone and TIN from the customer snapshot
UPDATE "SalesOrder" SET "subject" = coalesce(nullif("billTo"->>'name', ''), "number"), "phone" = nullif("billTo"->>'phone', ''), "tinNumber" = nullif("billTo"->>'taxId', '') WHERE "subject" IS NULL;
