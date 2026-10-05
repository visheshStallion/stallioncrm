-- CreateEnum
CREATE TYPE "SetupApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "setupSections" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BrandAdmin" (
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAdmin_pkey" PRIMARY KEY ("userId","brandId")
);

-- CreateTable
CREATE TABLE "OrgSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SetupApproval" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SetupApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,

    CONSTRAINT "SetupApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "sourceTerritoryId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'READ',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRule" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandAdmin_brandId_idx" ON "BrandAdmin"("brandId");

-- CreateIndex
CREATE INDEX "SetupApproval_status_requestedAt_idx" ON "SetupApproval"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "SharingRule_module_active_idx" ON "SharingRule"("module", "active");

-- CreateIndex
CREATE INDEX "ValidationRule_module_active_idx" ON "ValidationRule"("module", "active");

-- AddForeignKey
ALTER TABLE "BrandAdmin" ADD CONSTRAINT "BrandAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAdmin" ADD CONSTRAINT "BrandAdmin_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 19 – Setup)
-- ---------------------------------------------------------------------------

-- Setup tables are read and written by the Setup services only (system client, after the tier check):
-- user sessions (role stallion_rls) have no access at all.
ALTER TABLE "BrandAdmin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SetupApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SharingRule" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BrandAdmin", "ValidationRule", "OrgSetting", "SetupApproval", "SharingRule" FROM stallion_rls;

-- The Super Admin flag cannot be changed from a user session, whatever the application code does:
-- only the Setup service (system client) grants or revokes it.
CREATE OR REPLACE FUNCTION app_guard_super_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'stallion_rls' THEN
    IF TG_OP = 'INSERT' AND NEW."isSuperAdmin" THEN
      RAISE EXCEPTION 'The Super Admin flag cannot be set from a user session';
    ELSIF TG_OP = 'UPDATE' AND NEW."isSuperAdmin" IS DISTINCT FROM OLD."isSuperAdmin" THEN
      RAISE EXCEPTION 'The Super Admin flag cannot be changed from a user session';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER super_admin_flag_guard BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION app_guard_super_admin();

-- The last active Super Admin cannot be deactivated or demoted (the service says so first; this is the backstop).
CREATE OR REPLACE FUNCTION app_keep_one_super_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isSuperAdmin" AND OLD."active" AND NOT (NEW."isSuperAdmin" AND NEW."active")
     AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isSuperAdmin" AND "active" AND "id" <> OLD."id") THEN
    RAISE EXCEPTION 'The last Super Admin cannot be disabled or demoted';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER keep_one_super_admin BEFORE UPDATE OF "isSuperAdmin", "active" ON "User" FOR EACH ROW EXECUTE FUNCTION app_keep_one_super_admin();

-- Existing installations: when nobody is a Super Admin yet, the (up to three) longest-serving active
-- administrators become Super Admins, so the SA-only functions are reachable after the upgrade.
UPDATE "User" SET "isSuperAdmin" = true
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "isSuperAdmin")
  AND "id" IN (
    SELECT u."id" FROM "User" u JOIN "Profile" p ON p."id" = u."profileId"
    WHERE u."active" AND NOT u."isIntegration" AND (p."permissions" -> 'admin' ->> 'edit') = 'true'
    ORDER BY u."createdAt", u."id" LIMIT 3
  );

-- Password expiry counts from when the password was set; for existing accounts that is unknown, so it counts
-- from the day the account was created.
UPDATE "User" SET "passwordChangedAt" = "createdAt" WHERE "passwordHash" IS NOT NULL AND "passwordChangedAt" IS NULL;

-- User sessions read the User table column by column (the password hash is never readable): the new columns that
-- are safe to read. passwordHistory holds earlier password hashes and stays unreadable, like passwordHash.
GRANT SELECT ("isSuperAdmin", "sessionsValidAfter", "passwordChangedAt") ON "User" TO stallion_rls;
