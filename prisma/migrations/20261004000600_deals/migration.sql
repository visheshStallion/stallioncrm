-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "colour" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "depositAmount" DECIMAL(14,2),
ADD COLUMN     "depositReceiptNo" TEXT,
ADD COLUMN     "discountPct" DECIMAL(5,2),
ADD COLUMN     "engineNo" TEXT,
ADD COLUMN     "financeBank" TEXT,
ADD COLUMN     "lossCompetitorBrand" TEXT,
ADD COLUMN     "lossReason" TEXT,
ADD COLUMN     "paymentType" "PaymentIntent",
ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stageId" TEXT,
ADD COLUMN     "testDriveDate" TIMESTAMP(3),
ADD COLUMN     "tradeInDetails" TEXT,
ADD COLUMN     "vinChassisNo" TEXT;


-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "type" "StageType" NOT NULL DEFAULT 'OPEN',
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "allowedTransitions" JSONB,
    "maxDaysInStage" INTEGER,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStageHistory" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "durationHours" DECIMAL(10,2),

    CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_brandId_name_key" ON "Pipeline"("brandId", "name");

-- CreateIndex
CREATE INDEX "PipelineStage_pipelineId_order_idx" ON "PipelineStage"("pipelineId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_key_key" ON "PipelineStage"("pipelineId", "key");

-- CreateIndex
CREATE INDEX "DealStageHistory_dealId_at_idx" ON "DealStageHistory"("dealId", "at");

-- CreateIndex
CREATE INDEX "Note_entity_entityId_idx" ON "Note"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Note_brandId_regionId_idx" ON "Note"("brandId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_entity_entityId_idx" ON "Attachment"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Attachment_brandId_regionId_idx" ON "Attachment"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Deal_stageId_idx" ON "Deal"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_brandId_vinChassisNo_key" ON "Deal"("brandId", "vinChassisNo");

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Default pipeline per brand (BUSINESS_CONTEXT section 9). Created with the brand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_ensure_default_pipeline(p_brand text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pipeline text;
BEGIN
  SELECT id INTO v_pipeline FROM "Pipeline" WHERE "brandId" = p_brand AND "isDefault" LIMIT 1;
  IF v_pipeline IS NOT NULL THEN
    RETURN v_pipeline;
  END IF;
  v_pipeline := 'pl_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO "Pipeline" (id, "brandId", name, "isDefault", "updatedAt")
  VALUES (v_pipeline, p_brand, 'Standard Sales', true, now());
  INSERT INTO "PipelineStage" (id, "pipelineId", key, name, "order", probability, type, "requiredFields", "maxDaysInStage")
  SELECT 'ps_' || replace(gen_random_uuid()::text, '-', ''), v_pipeline, s.key, s.name, s.ord, s.prob, s.type::"StageType", s.req::jsonb, s.maxdays
  FROM (VALUES
    ('ENQUIRY',         'Enquiry',           1,  10, 'OPEN', '[]',                                  7),
    ('TEST_DRIVE',      'Test Drive',        2,  25, 'OPEN', '["testDriveDate","modelId"]',         7),
    ('QUOTATION',       'Quotation',         3,  40, 'OPEN', '["quote"]',                           7),
    ('BOOKING',         'Booking',           4,  70, 'OPEN', '["depositAmount","depositReceiptNo"]', 14),
    ('FINANCE_PAYMENT', 'Finance / Payment', 5,  85, 'OPEN', '[]',                                  21),
    ('DELIVERY',        'Delivery',          6,  95, 'OPEN', '["vinChassisNo","deliveryDate"]',     14),
    ('CLOSED_WON',      'Closed Won',        7, 100, 'WON',  '[]',                                  NULL),
    ('CLOSED_LOST',     'Closed Lost',       8,   0, 'LOST', '["lossReason"]',                      NULL)
  ) AS s(key, name, ord, prob, type, req, maxdays);
  RETURN v_pipeline;
END
$$;

CREATE OR REPLACE FUNCTION app_brand_default_pipeline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_ensure_default_pipeline(NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER brand_default_pipeline AFTER INSERT ON "Brand"
FOR EACH ROW EXECUTE FUNCTION app_brand_default_pipeline();

SELECT app_ensure_default_pipeline(id) FROM "Brand";

-- Existing deals: map the old stage enum to the brand's pipeline stage, then drop the enum column.
UPDATE "Deal" d
SET "pipelineId" = p.id, "stageId" = s.id
FROM "Pipeline" p
JOIN "PipelineStage" s ON s."pipelineId" = p.id
WHERE p."brandId" = d."brandId" AND p."isDefault" AND s.key = d."stage"::text;

ALTER TABLE "Deal" DROP COLUMN "stage";
DROP TYPE "DealStage";

-- ---------------------------------------------------------------------------
-- Deal integrity: pipeline belongs to the deal's brand, stage belongs to the pipeline.
-- Missing values are filled with the brand's default pipeline / first stage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_deal_pipeline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."brandId" IS DISTINCT FROM OLD."brandId" THEN
    -- Brand changed: move to the new brand's default pipeline, keeping the stage by key.
    SELECT key INTO v_key FROM "PipelineStage" WHERE id = OLD."stageId";
    NEW."pipelineId" := app_ensure_default_pipeline(NEW."brandId");
    NEW."stageId" := (SELECT id FROM "PipelineStage" WHERE "pipelineId" = NEW."pipelineId" AND key = v_key);
  END IF;

  IF NEW."pipelineId" IS NULL THEN
    IF NEW."stageId" IS NOT NULL THEN
      NEW."pipelineId" := (SELECT "pipelineId" FROM "PipelineStage" WHERE id = NEW."stageId");
    ELSE
      NEW."pipelineId" := app_ensure_default_pipeline(NEW."brandId");
    END IF;
  END IF;

  SELECT "brandId" INTO v_brand FROM "Pipeline" WHERE id = NEW."pipelineId";
  IF v_brand IS DISTINCT FROM NEW."brandId" THEN
    RAISE EXCEPTION 'The pipeline does not belong to the deal''s brand' USING ERRCODE = '23514';
  END IF;

  IF NEW."stageId" IS NULL THEN
    NEW."stageId" := (SELECT id FROM "PipelineStage" WHERE "pipelineId" = NEW."pipelineId" ORDER BY "order" LIMIT 1);
  ELSIF NOT EXISTS (SELECT 1 FROM "PipelineStage" WHERE id = NEW."stageId" AND "pipelineId" = NEW."pipelineId") THEN
    RAISE EXCEPTION 'The stage does not belong to the deal''s pipeline' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."stageId" IS DISTINCT FROM OLD."stageId" THEN
    NEW."stageEnteredAt" := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER deal_pipeline BEFORE INSERT OR UPDATE ON "Deal"
FOR EACH ROW EXECUTE FUNCTION app_deal_pipeline();

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stage_set" CHECK ("pipelineId" IS NOT NULL AND "stageId" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Stage history: written by trigger on every stage change (any code path).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_deal_stage_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "DealStageHistory" (id, "dealId", "fromStageId", "toStageId", "at", "userId")
    VALUES ('dh_' || replace(gen_random_uuid()::text, '-', ''), NEW.id, NULL, NEW."stageId", now(), NEW."createdById");
  ELSIF NEW."stageId" IS DISTINCT FROM OLD."stageId" THEN
    INSERT INTO "DealStageHistory" (id, "dealId", "fromStageId", "toStageId", "at", "userId", "durationHours")
    VALUES ('dh_' || replace(gen_random_uuid()::text, '-', ''), NEW.id, OLD."stageId", NEW."stageId", now(), NEW."updatedById",
            round((extract(epoch FROM (now() - OLD."stageEnteredAt")) / 3600)::numeric, 2));
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER deal_stage_history AFTER INSERT OR UPDATE OF "stageId" ON "Deal"
FOR EACH ROW EXECUTE FUNCTION app_deal_stage_history();

INSERT INTO "DealStageHistory" (id, "dealId", "fromStageId", "toStageId", "at", "userId")
SELECT 'dh_' || replace(gen_random_uuid()::text, '-', ''), d.id, NULL, d."stageId", d."createdAt", d."createdById"
FROM "Deal" d;

-- History is read-only for user sessions and visible only when the deal is visible (Deal RLS applies in the subquery).
REVOKE INSERT, UPDATE, DELETE ON "DealStageHistory" FROM stallion_rls;
ALTER TABLE "DealStageHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_history_read ON "DealStageHistory" FOR SELECT TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "Deal" d WHERE d.id = "dealId"));

-- Notes and attachments are brand-owned.
SELECT app_enable_brand_rls('"Note"');
SELECT app_enable_brand_rls('"Attachment"');
