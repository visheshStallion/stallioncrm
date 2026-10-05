-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "copyWatermark" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rcNumber" TEXT,
ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "bcc" TEXT,
ADD COLUMN     "bodyHtml" TEXT,
ADD COLUMN     "cc" TEXT;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Sales',
ADD COLUMN     "folder" TEXT,
ADD COLUMN     "module" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PrintTemplate" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT,
    "paper" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "draft" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "blocks" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSignature" (
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSignature_pkey" PRIMARY KEY ("userId","brandId")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sendAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintTemplate_module_active_idx" ON "PrintTemplate"("module", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplate_module_brandId_name_key" ON "PrintTemplate"("module", "brandId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplateVersion_templateId_version_key" ON "PrintTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "EmailDraft_userId_status_idx" ON "EmailDraft"("userId", "status");

-- CreateIndex
CREATE INDEX "EmailDraft_parentType_parentId_idx" ON "EmailDraft"("parentType", "parentId");

-- AddForeignKey
ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTemplateVersion" ADD CONSTRAINT "PrintTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PrintTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSignature" ADD CONSTRAINT "EmailSignature_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written part (prompt 20 – print templates and e-mail editor)
-- ---------------------------------------------------------------------------

-- Print templates: user sessions may READ the templates of their brands and the all-brand ones (the template
-- picker). They are written by the print service only (system client, after the tier and brand check).
ALTER TABLE "PrintTemplate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PrintTemplate" FROM stallion_rls;
GRANT SELECT ON "PrintTemplate" TO stallion_rls;
CREATE POLICY print_template_read ON "PrintTemplate" FOR SELECT TO stallion_rls USING ("brandId" IS NULL OR app_has_brand("brandId"));

-- Version history, signatures and drafts are reached through their services only.
ALTER TABLE "PrintTemplateVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TemplateVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSignature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailDraft" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PrintTemplateVersion", "TemplateVersion", "EmailSignature", "EmailDraft" FROM stallion_rls;
