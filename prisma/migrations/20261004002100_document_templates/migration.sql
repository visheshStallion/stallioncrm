-- AlterEnum
ALTER TYPE "ApproverType" ADD VALUE 'BRAND_ADMIN_OF_RECORD';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "brandId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "paper" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "margins" JSONB NOT NULL DEFAULT '{}',
    "content" JSONB NOT NULL,
    "published" JSONB,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "cssOverrides" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER NOT NULL DEFAULT 0,
    "templateName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "generatedById" TEXT NOT NULL,
    "generatedByName" TEXT NOT NULL DEFAULT '',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentVia" TEXT NOT NULL,
    "emailActivityId" TEXT,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTemplate_module_status_idx" ON "DocumentTemplate"("module", "status");

-- CreateIndex
CREATE INDEX "DocumentTemplate_createdById_idx" ON "DocumentTemplate"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "GeneratedDocument_module_recordId_idx" ON "GeneratedDocument"("module", "recordId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_brandId_idx" ON "GeneratedDocument"("brandId");

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 21 – document template builder)
-- ---------------------------------------------------------------------------

-- Document templates, their versions and the generated copies are reached through the document-template service
-- only (system client after the visibility, brand and record checks) – user sessions have no direct access.
ALTER TABLE "DocumentTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentTemplateVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeneratedDocument" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DocumentTemplate", "DocumentTemplateVersion", "GeneratedDocument" FROM stallion_rls;

-- A generated copy is a legal record: its file, hash and origin never change.
CREATE OR REPLACE FUNCTION app_generated_document_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."fileKey" IS DISTINCT FROM OLD."fileKey" OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW."recordId" IS DISTINCT FROM OLD."recordId"
     OR NEW.module IS DISTINCT FROM OLD.module OR NEW."brandId" IS DISTINCT FROM OLD."brandId" OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
     OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion" OR NEW."generatedById" IS DISTINCT FROM OLD."generatedById"
     OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt" THEN
    RAISE EXCEPTION 'A generated document cannot be changed';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER generated_document_immutable BEFORE UPDATE ON "GeneratedDocument" FOR EACH ROW EXECUTE FUNCTION app_generated_document_immutable();
