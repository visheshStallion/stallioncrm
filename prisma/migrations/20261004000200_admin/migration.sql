-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "logoData" BYTEA,
ADD COLUMN     "logoMimeType" TEXT;

-- Profile permission module "setup" was renamed to "admin" (prompt 01).
UPDATE "Profile"
SET permissions = (permissions - 'setup') || jsonb_build_object('admin', permissions -> 'setup')
WHERE permissions ? 'setup';
