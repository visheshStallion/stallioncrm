-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('COMPLAINT', 'ENQUIRY', 'DELIVERY_ISSUE', 'WARRANTY', 'DOCUMENTATION', 'BILLING');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CaseChannel" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'WALK_IN', 'WEB');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "salesOrderId" TEXT,
    "vin" TEXT,
    "type" "CaseType" NOT NULL DEFAULT 'ENQUIRY',
    "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "channel" "CaseChannel" NOT NULL DEFAULT 'PHONE',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "unassigned" BOOLEAN NOT NULL DEFAULT false,
    "firstResponseDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "satisfactionScore" INTEGER,
    "satisfactionNote" TEXT,
    "surveyToken" TEXT,
    "surveySentAt" TIMESTAMP(3),
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "priority" "CasePriority" NOT NULL,
    "firstResponseHours" INTEGER NOT NULL,
    "resolutionHours" INTEGER NOT NULL,
    "escalateToRole" TEXT NOT NULL DEFAULT 'Brand Manager',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Solution" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Solution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "opensAt" TEXT NOT NULL DEFAULT '08:00',
    "closesAt" TEXT NOT NULL DEFAULT '17:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "Case_number_key" ON "Case"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Case_surveyToken_key" ON "Case"("surveyToken");

-- CreateIndex
CREATE INDEX "Case_brandId_regionId_idx" ON "Case"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Case_ownerId_status_idx" ON "Case"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Case_status_slaDueAt_idx" ON "Case"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "Case_accountId_idx" ON "Case"("accountId");

-- CreateIndex
CREATE INDEX "Case_dealId_idx" ON "Case"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_brandId_priority_key" ON "SlaPolicy"("brandId", "priority");

-- CreateIndex
CREATE INDEX "Solution_brandId_published_idx" ON "Solution"("brandId", "published");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Solution" ADD CONSTRAINT "Solution_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row level security (prompt 11)
-- ---------------------------------------------------------------------------
SELECT app_enable_brand_rls('"Case"');
SELECT app_track_customer_links('"Case"');

-- SLA policies: readable by the brand's users, written by management / the brand's managers.
ALTER TABLE "SlaPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_read ON "SlaPolicy" FOR SELECT TO stallion_rls USING (app_has_brand("brandId"));
CREATE POLICY sla_insert ON "SlaPolicy" FOR INSERT TO stallion_rls WITH CHECK (app_scope_all() OR app_brand_level("brandId"));
CREATE POLICY sla_update ON "SlaPolicy" FOR UPDATE TO stallion_rls
  USING (app_scope_all() OR app_brand_level("brandId")) WITH CHECK (app_scope_all() OR app_brand_level("brandId"));
CREATE POLICY sla_delete ON "SlaPolicy" FOR DELETE TO stallion_rls USING (app_scope_all() OR app_brand_level("brandId"));

-- Solutions: group articles for everyone, brand articles only for that brand's users.
ALTER TABLE "Solution" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solution_read ON "Solution" FOR SELECT TO stallion_rls USING ("brandId" IS NULL OR app_has_brand("brandId"));
CREATE POLICY solution_insert ON "Solution" FOR INSERT TO stallion_rls
  WITH CHECK (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND (app_scope_all() OR app_brand_level("brandId"))));
CREATE POLICY solution_update ON "Solution" FOR UPDATE TO stallion_rls
  USING (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND (app_scope_all() OR app_brand_level("brandId"))))
  WITH CHECK (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND (app_scope_all() OR app_brand_level("brandId"))));
CREATE POLICY solution_delete ON "Solution" FOR DELETE TO stallion_rls
  USING (("brandId" IS NULL AND app_scope_all()) OR ("brandId" IS NOT NULL AND (app_scope_all() OR app_brand_level("brandId"))));

-- Business calendar: everyone reads, only scope ALL writes (the service additionally requires an administrator).
ALTER TABLE "BusinessHours" ENABLE ROW LEVEL SECURITY;
CREATE POLICY hours_read ON "BusinessHours" FOR SELECT TO stallion_rls USING (true);
CREATE POLICY hours_write ON "BusinessHours" FOR UPDATE TO stallion_rls USING (app_scope_all()) WITH CHECK (app_scope_all());
REVOKE INSERT, DELETE ON "BusinessHours" FROM stallion_rls;
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY holiday_read ON "Holiday" FOR SELECT TO stallion_rls USING (true);
CREATE POLICY holiday_insert ON "Holiday" FOR INSERT TO stallion_rls WITH CHECK (app_scope_all());
CREATE POLICY holiday_delete ON "Holiday" FOR DELETE TO stallion_rls USING (app_scope_all());
REVOKE UPDATE ON "Holiday" FROM stallion_rls;

-- ---------------------------------------------------------------------------
-- Case defaults: number {docPrefix}-CS-{YYYY}-{00001} per brand and year (gap-free, immutable); a linked deal
-- must belong to the case's brand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_case_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_year int;
  v_seq int;
  v_brand text;
BEGIN
  IF NEW."dealId" IS NOT NULL THEN
    SELECT "brandId" INTO v_brand FROM "Deal" WHERE id = NEW."dealId";
    IF v_brand IS DISTINCT FROM NEW."brandId" THEN
      RAISE EXCEPTION 'The deal belongs to another brand' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND coalesce(NEW."number", '') = '' THEN
    v_year := extract(year FROM NEW."createdAt")::int;
    INSERT INTO "DocumentCounter" ("brandId", "type", "year", "last") VALUES (NEW."brandId", 'CS', v_year, 1)
    ON CONFLICT ("brandId", "type", "year") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
    RETURNING "last" INTO v_seq;
    SELECT coalesce(nullif("docPrefix", ''), code) INTO v_prefix FROM "Brand" WHERE id = NEW."brandId";
    NEW."number" := v_prefix || '-CS-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  ELSIF TG_OP = 'UPDATE' AND NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'Case numbers cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER case_defaults BEFORE INSERT OR UPDATE ON "Case" FOR EACH ROW EXECUTE FUNCTION app_case_defaults();

ALTER TABLE "Case" ADD CONSTRAINT "Case_satisfaction_range" CHECK ("satisfactionScore" IS NULL OR "satisfactionScore" BETWEEN 1 AND 5);

-- ---------------------------------------------------------------------------
-- Default SLA policies for every brand (existing and future).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_ensure_sla_policies(p_brand text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "SlaPolicy" (id, "brandId", priority, "firstResponseHours", "resolutionHours", "updatedAt")
  SELECT 'sla_' || replace(gen_random_uuid()::text, '-', ''), p_brand, v.priority::"CasePriority", v.first_response, v.resolution, now()
  FROM (VALUES ('URGENT', 1, 8), ('HIGH', 2, 16), ('MEDIUM', 4, 27), ('LOW', 9, 45)) AS v(priority, first_response, resolution)
  ON CONFLICT ("brandId", priority) DO NOTHING
$$;
CREATE OR REPLACE FUNCTION app_brand_sla_policies() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_ensure_sla_policies(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER brand_sla_policies AFTER INSERT ON "Brand" FOR EACH ROW EXECUTE FUNCTION app_brand_sla_policies();
SELECT app_ensure_sla_policies(id) FROM "Brand";

-- ---------------------------------------------------------------------------
-- Defaults that the dev seed's TRUNCATE ... CASCADE removes (it calls this function again): business hours,
-- fixed-date Nigerian public holidays, the SLA escalation rule and the standard case reports.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_cases() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  y int;
BEGIN
  INSERT INTO "BusinessHours" (id, "updatedAt") VALUES ('default', now()) ON CONFLICT DO NOTHING;
  FOR y IN extract(year FROM now())::int .. extract(year FROM now())::int + 1 LOOP
    INSERT INTO "Holiday" (date, name) VALUES
      (make_date(y, 1, 1), 'New Year''s Day'), (make_date(y, 5, 1), 'Workers'' Day'), (make_date(y, 6, 12), 'Democracy Day'),
      (make_date(y, 10, 1), 'Independence Day'), (make_date(y, 12, 25), 'Christmas Day'), (make_date(y, 12, 26), 'Boxing Day')
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO "WorkflowRule" (id, key, name, description, module, trigger, "triggerConfig", criteria, actions, "updatedAt") VALUES
    ('wf_case_sla', 'case-sla-escalation', 'Case breaching its SLA',
     'Escalates the case to the role of its SLA policy (default: the Brand Manager of the case''s brand).',
     'cases', 'SCHEDULED', '{"repeat":"ONCE"}',
     '{"all":[{"field":"isOpen","op":"eq","value":true},{"field":"slaBreached","op":"eq","value":true}]}',
     '[{"type":"CALL_FUNCTION","name":"escalateCase"}]', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO "Report" (id, key, name, description, module, folder, definition, "updatedAt") VALUES
    ('rp_cases_type', 'cases-by-brand-type', 'Cases by brand and type', 'Cases of this year per brand and case type.', 'cases', 'GROUP',
     '{"module":"cases","filters":[],"dateRange":{"field":"createdAt","preset":"THIS_YEAR"},"groupBy":[{"field":"brand"},{"field":"type"}],"summaries":[{"fn":"count"}],"chart":{"type":"bar"}}', now()),
    ('rp_cases_sla', 'case-sla-compliance', 'SLA compliance', 'Resolved and overdue cases by SLA outcome.', 'cases', 'GROUP',
     '{"module":"cases","filters":[],"dateRange":{"field":"createdAt","preset":"THIS_YEAR"},"groupBy":[{"field":"brand"},{"field":"slaOutcome"}],"summaries":[{"fn":"count"}],"chart":{"type":"bar"}}', now()),
    ('rp_cases_csat', 'case-csat', 'Customer satisfaction (CSAT)', 'Average satisfaction score of closed cases per brand and type.', 'cases', 'GROUP',
     '{"module":"cases","filters":[{"field":"satisfactionScore","op":"notEmpty"}],"dateRange":{"field":"createdAt","preset":"THIS_YEAR"},"groupBy":[{"field":"brand"},{"field":"type"}],"summaries":[{"fn":"count"},{"fn":"avg","field":"satisfactionScore"}],"chart":{"type":"bar"}}', now())
  ON CONFLICT DO NOTHING;
END
$fn$;

SELECT app_seed_cases();
