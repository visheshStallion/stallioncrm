-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "email" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "formViewId" TEXT,
ADD COLUMN     "orgAddress" TEXT,
ADD COLUMN     "orgCity" TEXT,
ADD COLUMN     "orgCountry" TEXT,
ADD COLUMN     "orgName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "tinNumber" TEXT;


-- Hand-written: existing quotes take subject, organisation, phone, e-mail and TIN from their customer snapshot
UPDATE "Quote" SET "subject" = coalesce(nullif("billTo"->>'name', ''), "number"),
  "orgName" = nullif("billTo"->>'company', ''), "orgAddress" = nullif("billTo"->>'address', ''), "orgCity" = nullif("billTo"->>'city', ''),
  "phone" = nullif("billTo"->>'phone', ''), "email" = nullif("billTo"->>'email', ''), "tinNumber" = nullif("billTo"->>'taxId', '')
WHERE "subject" IS NULL;
