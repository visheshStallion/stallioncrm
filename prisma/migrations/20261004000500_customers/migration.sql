-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "AccountType_new" AS ENUM ('INDIVIDUAL', 'CORPORATE', 'GOVERNMENT', 'FLEET');
ALTER TABLE "public"."Account" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "type" TYPE "AccountType_new" USING ((CASE "type"::text WHEN 'COMPANY' THEN 'CORPORATE' ELSE "type"::text END)::"AccountType_new");
ALTER TYPE "AccountType" RENAME TO "AccountType_old";
ALTER TYPE "AccountType_new" RENAME TO "AccountType";
DROP TYPE "public"."AccountType_old";
ALTER TABLE "Account" ALTER COLUMN "type" SET DEFAULT 'INDIVIDUAL';
COMMIT;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "address" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "primaryContactId" TEXT,
ADD COLUMN     "rcNumber" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "address" TEXT,
ADD COLUMN     "altPhone" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "preferredChannel" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- CreateTable
CREATE TABLE "ContactBrandConsent" (
    "contactId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "consent" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactBrandConsent_pkey" PRIMARY KEY ("contactId","brandId")
);

-- CreateTable
CREATE TABLE "CustomerBrandLink" (
    "accountId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBrandLink_pkey" PRIMARY KEY ("accountId","brandId")
);

-- CreateIndex
CREATE INDEX "CustomerBrandLink_brandId_idx" ON "CustomerBrandLink"("brandId");

-- CreateIndex
CREATE INDEX "Account_rcNumber_idx" ON "Account"("rcNumber");

-- CreateIndex
CREATE INDEX "Account_name_idx" ON "Account"("name");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBrandConsent" ADD CONSTRAINT "ContactBrandConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBrandConsent" ADD CONSTRAINT "ContactBrandConsent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBrandLink" ADD CONSTRAINT "CustomerBrandLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBrandLink" ADD CONSTRAINT "CustomerBrandLink_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Customer <-> brand links (maintained automatically)
-- Any brand-owned table with an "accountId" column gets this trigger:
--   SELECT app_track_customer_links('"<Model>"');
-- tests/integration/customers.test.ts fails if a brand-owned model with accountId lacks it.
CREATE OR REPLACE FUNCTION app_link_customer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."accountId" IS NOT NULL THEN
    INSERT INTO "CustomerBrandLink" ("accountId", "brandId", "firstSeenAt")
    VALUES (NEW."accountId", NEW."brandId", now())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION app_track_customer_links(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS customer_link ON %s', p_table);
  EXECUTE format(
    'CREATE TRIGGER customer_link AFTER INSERT OR UPDATE OF "accountId", "brandId" ON %s FOR EACH ROW EXECUTE FUNCTION app_link_customer()',
    p_table);
END
$$;

SELECT app_track_customer_links('"Deal"');

-- Backfill links for existing records.
INSERT INTO "CustomerBrandLink" ("accountId", "brandId", "firstSeenAt")
SELECT "accountId", "brandId", min("createdAt") FROM "Deal" WHERE "accountId" IS NOT NULL GROUP BY 1, 2
ON CONFLICT DO NOTHING;

-- Links are written only by the trigger (or the system merge) - never by a user session.
REVOKE INSERT, UPDATE, DELETE ON "CustomerBrandLink" FROM stallion_rls;

-- Customer masking now follows the field tiers (basic / contact details / sensitive) instead of static
-- profile field permissions.
UPDATE "Profile" SET "fieldPermissions" = ("fieldPermissions" - 'accounts') - 'contacts';
