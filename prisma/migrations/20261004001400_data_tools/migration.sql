-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'UNDONE');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lookupTarget" TEXT,
    "formula" TEXT,
    "brandId" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Layout" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "brandId" TEXT,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'DRAFT',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB,
    "summary" JSONB,
    "problems" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER,
    "fileName" TEXT,
    "storageKey" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_module_brandId_idx" ON "CustomField"("module", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_module_apiName_key" ON "CustomField"("module", "apiName");

-- CreateIndex
CREATE INDEX "Layout_module_idx" ON "Layout"("module");

-- CreateIndex
CREATE INDEX "ImportJob_userId_createdAt_idx" ON "ImportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRecord_importId_idx" ON "ImportRecord"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMapping_userId_module_name_key" ON "ImportMapping"("userId", "module", "name");

-- CreateIndex
CREATE INDEX "ExportJob_userId_createdAt_idx" ON "ExportJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row level security (prompt 12)
-- ---------------------------------------------------------------------------
-- Custom fields and layouts are configuration: group items readable by everyone, brand items by that brand's
-- users; written by scope ALL only (the service additionally requires an administrator).
ALTER TABLE "CustomField" ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_field_read ON "CustomField" FOR SELECT TO stallion_rls USING ("brandId" IS NULL OR app_has_brand("brandId"));
CREATE POLICY custom_field_insert ON "CustomField" FOR INSERT TO stallion_rls WITH CHECK (app_scope_all());
CREATE POLICY custom_field_update ON "CustomField" FOR UPDATE TO stallion_rls USING (app_scope_all()) WITH CHECK (app_scope_all());
CREATE POLICY custom_field_delete ON "CustomField" FOR DELETE TO stallion_rls USING (app_scope_all());

ALTER TABLE "Layout" ENABLE ROW LEVEL SECURITY;
CREATE POLICY layout_read ON "Layout" FOR SELECT TO stallion_rls USING ("brandId" IS NULL OR app_has_brand("brandId"));
CREATE POLICY layout_insert ON "Layout" FOR INSERT TO stallion_rls WITH CHECK (app_scope_all());
CREATE POLICY layout_update ON "Layout" FOR UPDATE TO stallion_rls USING (app_scope_all()) WITH CHECK (app_scope_all());
CREATE POLICY layout_delete ON "Layout" FOR DELETE TO stallion_rls USING (app_scope_all());
-- one layout per module and brand variant
CREATE UNIQUE INDEX "Layout_module_brand" ON "Layout" (module, coalesce("brandId", ''));

-- Imports, saved mappings and exports belong to the user who ran them; management may read the import history.
ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_job_read ON "ImportJob" FOR SELECT TO stallion_rls USING ("userId" = app_user_id() OR app_scope_all());
CREATE POLICY import_job_insert ON "ImportJob" FOR INSERT TO stallion_rls WITH CHECK ("userId" = app_user_id());
CREATE POLICY import_job_update ON "ImportJob" FOR UPDATE TO stallion_rls USING ("userId" = app_user_id()) WITH CHECK ("userId" = app_user_id());
CREATE POLICY import_job_delete ON "ImportJob" FOR DELETE TO stallion_rls USING ("userId" = app_user_id());

ALTER TABLE "ImportRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_record ON "ImportRecord" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "ImportJob" j WHERE j.id = "importId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ImportJob" j WHERE j.id = "importId" AND j."userId" = app_user_id()));

ALTER TABLE "ImportMapping" ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_mapping_read ON "ImportMapping" FOR SELECT TO stallion_rls USING ("userId" = app_user_id() OR shared);
CREATE POLICY import_mapping_insert ON "ImportMapping" FOR INSERT TO stallion_rls WITH CHECK ("userId" = app_user_id());
CREATE POLICY import_mapping_update ON "ImportMapping" FOR UPDATE TO stallion_rls USING ("userId" = app_user_id()) WITH CHECK ("userId" = app_user_id());
CREATE POLICY import_mapping_delete ON "ImportMapping" FOR DELETE TO stallion_rls USING ("userId" = app_user_id());

ALTER TABLE "ExportJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY export_job ON "ExportJob" FOR ALL TO stallion_rls USING ("userId" = app_user_id()) WITH CHECK ("userId" = app_user_id());

-- A brand-specific custom field only exists for brand-owned modules.
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_brand_modules" CHECK ("brandId" IS NULL OR module IN ('leads', 'deals', 'cases'));
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_api_name" CHECK ("apiName" ~ '^[a-z][a-zA-Z0-9]{1,39}$');

-- ---------------------------------------------------------------------------
-- Default layout rule (BUSINESS_CONTEXT): the finance bank is only asked for bank-financed deals.
-- Idempotent; also called by the dev seed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_layouts() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "Layout" (id, module, "brandId", definition, "updatedAt")
  SELECT 'layout_deals', 'deals', NULL,
         '{"sections":[],"required":[],"rules":[{"when":{"field":"paymentType","op":"eq","value":"BANK_FINANCE"},"action":"SHOW","fields":["financeBank"]}]}'::jsonb, now()
  WHERE NOT EXISTS (SELECT 1 FROM "Layout" WHERE module = 'deals' AND "brandId" IS NULL);
END
$fn$;
SELECT app_seed_layouts();
