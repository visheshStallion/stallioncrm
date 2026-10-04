-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED', 'SUPPRESSED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('LAUNCH', 'PROMO', 'SERVICE_REMINDER', 'EVENT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'RESPONDED', 'UNSUBSCRIBED', 'FAILED', 'SUPPRESSED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'SMS_LOG';

-- DropIndex
DROP INDEX "Deal_closeDate_idx";

-- DropIndex
DROP INDEX "Deal_stageEnteredAt_idx";

-- DropIndex
DROP INDEX "Lead_createdAt_idx";

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "fromEmail" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "smsInboundNumber" TEXT,
ADD COLUMN     "smsSenderId" TEXT,
ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "whatsappPhoneId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "direction" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "activityId" TEXT,
    "contactId" TEXT,
    "campaignId" TEXT,
    "campaignMemberId" TEXT,
    "templateId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "whatsappStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "whatsappName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'PROMO',
    "channel" "Channel" NOT NULL,
    "budget" DECIMAL(14,2),
    "startDate" DATE,
    "endDate" DATE,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "launchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMember" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "messageId" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_parentType_parentId_idx" ON "Message"("parentType", "parentId");

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_brandId_regionId_idx" ON "Message"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Message_campaignId_idx" ON "Message"("campaignId");

-- CreateIndex
CREATE INDEX "Template_brandId_channel_idx" ON "Template"("brandId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE INDEX "Campaign_brandId_status_idx" ON "Campaign"("brandId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMember_unsubscribeToken_key" ON "CampaignMember"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "CampaignMember_campaignId_status_idx" ON "CampaignMember"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMember_campaignId_address_key" ON "CampaignMember"("campaignId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_smsInboundNumber_key" ON "Brand"("smsInboundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_whatsappNumber_key" ON "Brand"("whatsappNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_whatsappPhoneId_key" ON "Brand"("whatsappPhoneId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row level security (prompt 10)
-- ---------------------------------------------------------------------------
-- Messages are brand-owned: the content of a message on an SNMNL record is invisible to HMNL users.
SELECT app_enable_brand_rls('"Message"');

-- Campaigns belong to one brand.
SELECT app_enable_brand_tag_rls('"Campaign"');

-- Members follow their campaign (the Campaign policy applies inside the subquery).
ALTER TABLE "CampaignMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_member ON "CampaignMember" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "Campaign" c WHERE c.id = "campaignId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Campaign" c WHERE c.id = "campaignId"));

-- Templates: group templates (brand NULL) are readable by everyone and written by management; brand templates
-- belong to the brand's users (the service additionally requires a brand manager).
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY template_read ON "Template" FOR SELECT TO stallion_rls USING ("brandId" IS NULL OR app_has_brand("brandId"));
CREATE POLICY template_insert ON "Template" FOR INSERT TO stallion_rls
  WITH CHECK (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND app_has_brand("brandId")));
CREATE POLICY template_update ON "Template" FOR UPDATE TO stallion_rls
  USING (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND app_has_brand("brandId")))
  WITH CHECK (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND app_has_brand("brandId")));
CREATE POLICY template_delete ON "Template" FOR DELETE TO stallion_rls
  USING (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND app_has_brand("brandId")));

-- ---------------------------------------------------------------------------
-- A lead / deal can only be attributed to a campaign of its own brand; a campaign only uses a template of its
-- brand (or a group template).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_campaign_same_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
BEGIN
  IF TG_TABLE_NAME = 'Campaign' THEN
    IF NEW."templateId" IS NOT NULL THEN
      SELECT "brandId" INTO v_brand FROM "Template" WHERE id = NEW."templateId";
      IF v_brand IS NOT NULL AND v_brand <> NEW."brandId" THEN
        RAISE EXCEPTION 'The template belongs to another brand' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."campaignId" IS NOT NULL THEN
    SELECT "brandId" INTO v_brand FROM "Campaign" WHERE id = NEW."campaignId";
    IF v_brand IS DISTINCT FROM NEW."brandId" THEN
      RAISE EXCEPTION 'The campaign belongs to another brand' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER lead_campaign_brand BEFORE INSERT OR UPDATE OF "campaignId", "brandId" ON "Lead" FOR EACH ROW EXECUTE FUNCTION app_campaign_same_brand();
CREATE TRIGGER deal_campaign_brand BEFORE INSERT OR UPDATE OF "campaignId", "brandId" ON "Deal" FOR EACH ROW EXECUTE FUNCTION app_campaign_same_brand();
CREATE TRIGGER campaign_template_brand BEFORE INSERT OR UPDATE OF "templateId", "brandId" ON "Campaign" FOR EACH ROW EXECUTE FUNCTION app_campaign_same_brand();
