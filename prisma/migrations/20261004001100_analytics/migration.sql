-- CreateEnum
CREATE TYPE "ReportFolder" AS ENUM ('PRIVATE', 'BRAND', 'GROUP');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('MONTH', 'QUARTER');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "folder" "ReportFolder" NOT NULL DEFAULT 'PRIVATE',
    "brandId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT,
    "userId" TEXT,
    "units" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastNote" (
    "id" TEXT NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT,
    "userId" TEXT,
    "adjustment" DECIMAL(16,2),
    "note" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_key_key" ON "Report"("key");

-- CreateIndex
CREATE INDEX "Report_folder_brandId_idx" ON "Report"("folder", "brandId");

-- CreateIndex
CREATE INDEX "Report_ownerId_idx" ON "Report"("ownerId");

-- CreateIndex
CREATE INDEX "Target_periodType_periodStart_brandId_idx" ON "Target"("periodType", "periodStart", "brandId");

-- CreateIndex
CREATE INDEX "ForecastNote_periodType_periodStart_brandId_idx" ON "ForecastNote"("periodType", "periodStart", "brandId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastNote" ADD CONSTRAINT "ForecastNote_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastNote" ADD CONSTRAINT "ForecastNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row level security (prompt 09)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_brand_level(p_brand text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(nullif(current_setting('app.memberships', true), ''), '[]')::jsonb) AS m("brandId" text, "regionId" text)
    WHERE m."brandId" = p_brand AND m."regionId" IS NULL
  )
$$;

-- Reports: the folder decides who can OPEN a definition (private = owner, brand = users of the brand, group =
-- everyone). The data a report returns is always limited by the RLS of the tables it reads.
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_read ON "Report" FOR SELECT TO stallion_rls
  USING ("ownerId" = app_user_id() OR folder = 'GROUP' OR (folder = 'BRAND' AND app_has_brand("brandId")));
CREATE POLICY report_insert ON "Report" FOR INSERT TO stallion_rls
  WITH CHECK ("ownerId" = app_user_id() AND key IS NULL AND (folder <> 'BRAND' OR app_has_brand("brandId")));
CREATE POLICY report_update ON "Report" FOR UPDATE TO stallion_rls
  USING ("ownerId" = app_user_id())
  WITH CHECK ("ownerId" = app_user_id() AND key IS NULL AND (folder <> 'BRAND' OR app_has_brand("brandId")));
CREATE POLICY report_delete ON "Report" FOR DELETE TO stallion_rls USING ("ownerId" = app_user_id());

-- Targets: management, the brand's managers (brand-level membership), the members of the brand-region for
-- region and user targets, and the user the target belongs to. Written by management / brand-level members.
ALTER TABLE "Target" ENABLE ROW LEVEL SECURITY;
CREATE POLICY target_read ON "Target" FOR SELECT TO stallion_rls
  USING (app_scope_all() OR "userId" = app_user_id() OR app_brand_level("brandId")
         OR ("regionId" IS NOT NULL AND app_has_membership("brandId", "regionId")));
CREATE POLICY target_insert ON "Target" FOR INSERT TO stallion_rls WITH CHECK (app_scope_all() OR app_brand_level("brandId"));
CREATE POLICY target_update ON "Target" FOR UPDATE TO stallion_rls
  USING (app_scope_all() OR app_brand_level("brandId")) WITH CHECK (app_scope_all() OR app_brand_level("brandId"));
CREATE POLICY target_delete ON "Target" FOR DELETE TO stallion_rls USING (app_scope_all() OR app_brand_level("brandId"));

-- One target per period and level.
CREATE UNIQUE INDEX "Target_level" ON "Target" ("periodType", "periodStart", "brandId", coalesce("regionId", ''), coalesce("userId", ''));
ALTER TABLE "Target" ADD CONSTRAINT "Target_user_needs_region" CHECK ("userId" IS NULL OR "regionId" IS NOT NULL);
ALTER TABLE "Target" ADD CONSTRAINT "Target_not_negative" CHECK (units >= 0 AND revenue >= 0);

ALTER TABLE "ForecastNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_note_read ON "ForecastNote" FOR SELECT TO stallion_rls
  USING (app_scope_all() OR "authorId" = app_user_id() OR app_brand_level("brandId")
         OR ("regionId" IS NOT NULL AND app_has_membership("brandId", "regionId")));
CREATE POLICY forecast_note_insert ON "ForecastNote" FOR INSERT TO stallion_rls
  WITH CHECK ("authorId" = app_user_id() AND (app_scope_all() OR app_brand_level("brandId")
         OR ("regionId" IS NOT NULL AND app_has_membership("brandId", "regionId"))));
CREATE POLICY forecast_note_delete ON "ForecastNote" FOR DELETE TO stallion_rls USING ("authorId" = app_user_id());
REVOKE UPDATE ON "ForecastNote" FROM stallion_rls;

-- ---------------------------------------------------------------------------
-- Deal facts for dashboards and forecasts. security_invoker: the view runs with the caller's rights, so the RLS
-- policies of "Deal" apply to every row it returns.
-- ---------------------------------------------------------------------------
CREATE VIEW "DealFact" WITH (security_invoker = true) AS
SELECT d.id, d.name, d."brandId", d."regionId", d."ownerId", d."accountId", d."modelId",
       coalesce(d.amount, 0) AS amount, d.quantity, d."closeDate", d."createdAt", d."stageEnteredAt", d."discountPct",
       s.key AS "stageKey", s.name AS "stageName", s."order" AS "stageOrder", s.type::text AS "stageType", s.probability,
       round(coalesce(d.amount, 0) * s.probability / 100, 2) AS "weightedAmount",
       (s.type = 'OPEN' AND s.key IN ('BOOKING', 'FINANCE_PAYMENT', 'DELIVERY')) AS committed
FROM "Deal" d
JOIN "PipelineStage" s ON s.id = d."stageId"
WHERE d."deletedAt" IS NULL;
GRANT SELECT ON "DealFact" TO stallion_rls;

CREATE INDEX IF NOT EXISTS "Deal_stageId_idx" ON "Deal" ("stageId");
CREATE INDEX IF NOT EXISTS "Deal_closeDate_idx" ON "Deal" ("closeDate");
CREATE INDEX IF NOT EXISTS "Deal_stageEnteredAt_idx" ON "Deal" ("stageEnteredAt");
CREATE INDEX IF NOT EXISTS "Deal_ownerId_idx" ON "Deal" ("ownerId");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead" ("createdAt");

-- ---------------------------------------------------------------------------
-- Standard reports (owner NULL, folder GROUP). Idempotent: also called by the dev seed after its TRUNCATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_reports() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "Report" (id, key, name, description, module, folder, definition, "updatedAt") VALUES
    ('rp_pipeline', 'pipeline-by-stage-brand', 'Pipeline by stage and brand', 'Open deals: count, value and weighted value per brand and stage.', 'deals', 'GROUP',
     '{"module":"deals","filters":[{"field":"stageType","op":"eq","value":"OPEN"}],"groupBy":[{"field":"brand"},{"field":"stage"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"amount"},{"fn":"sum","field":"weightedAmount"}],"chart":{"type":"bar"}}', now()),
    ('rp_won', 'won-by-brand-region-month', 'Won deals by brand, region and month', 'Closed Won deals of this year.', 'deals', 'GROUP',
     '{"module":"deals","filters":[{"field":"stageType","op":"eq","value":"WON"}],"dateRange":{"field":"stageEnteredAt","preset":"THIS_YEAR"},"groupBy":[{"field":"brand"},{"field":"region"},{"field":"stageEnteredAt","granularity":"month"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"quantity"},{"fn":"sum","field":"amount"}],"chart":{"type":"bar"}}', now()),
    ('rp_funnel', 'conversion-funnel', 'Conversion funnel: Lead to Delivery', 'Leads created in the period and the deals that reached Test Drive, Booking and Delivery.', 'deals', 'GROUP',
     '{"module":"deals","special":"FUNNEL","dateRange":{"field":"createdAt","preset":"THIS_YEAR"},"filters":[],"groupBy":[],"summaries":[],"chart":{"type":"funnel"}}', now()),
    ('rp_source', 'lead-source-roi', 'Lead source ROI by brand', 'Leads, conversions and won revenue per lead source.', 'leads', 'GROUP',
     '{"module":"leads","special":"LEAD_SOURCE_ROI","dateRange":{"field":"createdAt","preset":"THIS_YEAR"},"filters":[],"groupBy":[],"summaries":[],"chart":{"type":"bar"}}', now()),
    ('rp_exec', 'exec-performance', 'Sales exec performance', 'Leads, test drives, bookings, deliveries and conversion per exec.', 'deals', 'GROUP',
     '{"module":"deals","special":"EXEC_PERFORMANCE","dateRange":{"field":"createdAt","preset":"THIS_QUARTER"},"filters":[],"groupBy":[],"summaries":[],"chart":{"type":"bar"}}', now()),
    ('rp_lost', 'lost-by-reason-competitor', 'Lost deals by reason and competitor', 'Closed Lost deals of this year.', 'deals', 'GROUP',
     '{"module":"deals","filters":[{"field":"stageType","op":"eq","value":"LOST"}],"dateRange":{"field":"stageEnteredAt","preset":"THIS_YEAR"},"groupBy":[{"field":"lossReason"},{"field":"lossCompetitorBrand"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"amount"}],"chart":{"type":"pie"}}', now()),
    ('rp_stale', 'stale-deals', 'Stale deals', 'Open deals that have been in their stage for more than 7 days.', 'deals', 'GROUP',
     '{"module":"deals","columns":["name","brand","region","owner","stage","daysInStage","amount","closeDate"],"filters":[{"field":"stageType","op":"eq","value":"OPEN"},{"field":"daysInStage","op":"gt","value":7}],"groupBy":[],"summaries":[],"sort":{"field":"daysInStage","dir":"desc"},"chart":{"type":"none"}}', now()),
    ('rp_discount', 'discount-given-vs-approved', 'Discount given vs approved', 'Quotes by discount approval outcome.', 'quotes', 'GROUP',
     '{"module":"quotes","filters":[],"dateRange":{"field":"issueDate","preset":"THIS_YEAR"},"groupBy":[{"field":"brand"},{"field":"approvalState"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"discountTotal"},{"fn":"avg","field":"discountPct"}],"chart":{"type":"bar"}}', now()),
    ('rp_aging', 'quote-aging', 'Quote aging', 'Open quotes by age.', 'quotes', 'GROUP',
     '{"module":"quotes","filters":[{"field":"status","op":"in","value":"DRAFT,PENDING_APPROVAL,APPROVED,SENT"}],"groupBy":[{"field":"brand"},{"field":"ageBucket"}],"summaries":[{"fn":"count"},{"fn":"sum","field":"total"}],"chart":{"type":"bar"}}', now())
  ON CONFLICT DO NOTHING;
END
$fn$;

SELECT app_seed_reports();
