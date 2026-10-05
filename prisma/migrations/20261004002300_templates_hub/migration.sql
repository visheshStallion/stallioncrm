-- CreateTable
CREATE TABLE "RecordTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "brandId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "lockedFields" JSONB NOT NULL DEFAULT '[]',
    "hiddenFields" JSONB NOT NULL DEFAULT '[]',
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "childRecords" JSONB NOT NULL DEFAULT '[]',
    "emailTemplateId" TEXT,
    "documentTemplateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordTemplateUse" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "module" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "brandId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordTemplateUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT,
    "ownerId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplatePlacement" (
    "kind" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "folderId" TEXT NOT NULL,

    CONSTRAINT "TemplatePlacement_pkey" PRIMARY KEY ("kind","templateId","scope")
);

-- CreateTable
CREATE TABLE "TemplateFavorite" (
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateFavorite_pkey" PRIMARY KEY ("userId","kind","templateId")
);

-- CreateIndex
CREATE INDEX "RecordTemplate_module_status_idx" ON "RecordTemplate"("module", "status");

-- CreateIndex
CREATE INDEX "RecordTemplate_createdById_idx" ON "RecordTemplate"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "RecordTemplateVersion_templateId_version_key" ON "RecordTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "RecordTemplateUse_templateId_createdAt_idx" ON "RecordTemplateUse"("templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecordTemplateUse_module_recordId_key" ON "RecordTemplateUse"("module", "recordId");

-- CreateIndex
CREATE INDEX "TemplateFolder_ownerId_idx" ON "TemplateFolder"("ownerId");

-- CreateIndex
CREATE INDEX "TemplatePlacement_folderId_idx" ON "TemplatePlacement"("folderId");

-- AddForeignKey
ALTER TABLE "RecordTemplate" ADD CONSTRAINT "RecordTemplate_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordTemplateVersion" ADD CONSTRAINT "RecordTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecordTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordTemplateUse" ADD CONSTRAINT "RecordTemplateUse_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecordTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateFolder" ADD CONSTRAINT "TemplateFolder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePlacement" ADD CONSTRAINT "TemplatePlacement_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "TemplateFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 22 – templates hub and record templates)
-- ---------------------------------------------------------------------------

-- Record templates, their history and uses, folders, placements and favourites are reached through the templates
-- services only (system client after the visibility and brand checks) – user sessions have no direct access.
ALTER TABLE "RecordTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecordTemplateVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecordTemplateUse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TemplateFolder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TemplatePlacement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TemplateFavorite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RecordTemplate", "RecordTemplateVersion", "RecordTemplateUse", "TemplateFolder", "TemplatePlacement", "TemplateFavorite" FROM stallion_rls;

-- Approval of shared record templates: the same single step as document templates (Brand Admin of the brand).
CREATE OR REPLACE FUNCTION app_seed_document_templates() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'INSERT INTO "ApprovalProcess" (id, key, name, module, criteria, "updatedAt") VALUES
  (''ap_document_template'', ''DOCUMENT_TEMPLATE'', ''Document template'', ''*'', ''{}'', now()),
  (''ap_record_template'', ''RECORD_TEMPLATE'', ''Record template'', ''*'', ''{}'', now())
  ON CONFLICT DO NOTHING';
  EXECUTE 'INSERT INTO "ApprovalStep" (id, "processId", "order", slot, "approverType", "roleName", condition) VALUES
  (''aps_document_template_1'', ''ap_document_template'', 1, NULL, ''BRAND_ADMIN_OF_RECORD'', NULL, NULL),
  (''aps_record_template_1'', ''ap_record_template'', 1, NULL, ''BRAND_ADMIN_OF_RECORD'', NULL, NULL)
  ON CONFLICT DO NOTHING';
END
$fn$;

SELECT app_seed_document_templates();
