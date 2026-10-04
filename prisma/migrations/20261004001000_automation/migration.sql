-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('BRAND_MANAGER_OF_RECORD', 'BRAND_MANAGER_OF_NEW_BRAND', 'ROLE', 'USER', 'RSM');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('ON_CREATE', 'ON_EDIT', 'FIELD_CHANGE', 'DATE_BASED', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "comments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "payload" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "processId" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ApprovalProcess" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "brandId" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "slot" TEXT,
    "approverType" "ApproverType" NOT NULL,
    "roleName" TEXT,
    "userId" TEXT,
    "condition" JSONB,
    "autoApproveAfterHours" INTEGER,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "autoApproveAt" TIMESTAMP(3),
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRule" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "trigger" "WorkflowTrigger" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "brandId" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "brandId" TEXT,
    "ruleId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalProcess_key_key" ON "ApprovalProcess"("key");

-- CreateIndex
CREATE INDEX "ApprovalStep_processId_order_idx" ON "ApprovalStep"("processId", "order");

-- CreateIndex
CREATE INDEX "ApprovalTask_approverId_status_idx" ON "ApprovalTask"("approverId", "status");

-- CreateIndex
CREATE INDEX "ApprovalTask_requestId_idx" ON "ApprovalTask"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRule_key_key" ON "WorkflowRule"("key");

-- CreateIndex
CREATE INDEX "WorkflowRule_module_trigger_active_idx" ON "WorkflowRule"("module", "trigger", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_ruleId_createdAt_idx" ON "Job"("ruleId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ApprovalProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalProcess" ADD CONSTRAINT "ApprovalProcess_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ApprovalProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalTask" ADD CONSTRAINT "ApprovalTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalTask" ADD CONSTRAINT "ApprovalTask_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRule" ADD CONSTRAINT "WorkflowRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row level security (prompt 08)
-- ---------------------------------------------------------------------------
-- Configuration tables: readable by every signed-in user, written only by the system client (admin services).
REVOKE INSERT, UPDATE, DELETE ON "ApprovalProcess", "ApprovalStep", "WorkflowRule" FROM stallion_rls;

-- Approval tasks: written by the approval engine (system client) only. Readable by the approver and by users
-- who can see the record's brand-region (or who submitted the request).
REVOKE INSERT, UPDATE, DELETE ON "ApprovalTask" FROM stallion_rls;
ALTER TABLE "ApprovalTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_task_read ON "ApprovalTask" FOR SELECT TO stallion_rls
  USING ("approverId" = app_user_id() OR app_can_read("brandId", "regionId", "requesterId"));

-- The job queue is system-only.
REVOKE ALL ON "Job" FROM stallion_rls;

-- ---------------------------------------------------------------------------
-- Records are locked while an approval is pending (except for administrators and the system client).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_pending_approval(p_entity text, p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM "ApprovalRequest" r WHERE r.entity = p_entity AND r."entityId" = p_id AND r.status = 'PENDING' AND r."deletedAt" IS NULL)
$$;

CREATE OR REPLACE FUNCTION app_lock_pending_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'stallion_rls'
     AND coalesce(current_setting('app.admin', true), '') <> '1'
     AND app_has_pending_approval(TG_TABLE_NAME, OLD.id) THEN
    RAISE EXCEPTION 'RECORD_LOCKED: this record is locked while an approval is pending' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER lead_approval_lock BEFORE UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION app_lock_pending_approval();
CREATE TRIGGER deal_approval_lock BEFORE UPDATE ON "Deal" FOR EACH ROW EXECUTE FUNCTION app_lock_pending_approval();
CREATE TRIGGER quote_approval_lock BEFORE UPDATE ON "Quote" FOR EACH ROW EXECUTE FUNCTION app_lock_pending_approval();

-- At most one pending request per record and kind.
CREATE UNIQUE INDEX "ApprovalRequest_one_pending" ON "ApprovalRequest" ("entity", "entityId", "kind") WHERE status = 'PENDING' AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Default approval processes and workflow rules (BUSINESS_CONTEXT 10). Idempotent: also called by the dev seed,
-- whose TRUNCATE ... CASCADE on Brand empties these tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_automation() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE '-- Seed: approval processes
INSERT INTO "ApprovalProcess" (id, key, name, module, criteria, "updatedAt") VALUES
  (''ap_discount'', ''DISCOUNT'', ''Discount approval'', ''quotes'', ''{}'', now()),
  (''ap_brand_change'', ''BRAND_CHANGE'', ''Brand change'', ''*'', ''{}'', now()),
  (''ap_owner_transfer'', ''OWNER_TRANSFER'', ''Owner transfer across regions'', ''*'', ''{}'', now())
  ON CONFLICT DO NOTHING;

INSERT INTO "ApprovalStep" (id, "processId", "order", slot, "approverType", "roleName", condition) VALUES
  (''aps_discount_1'', ''ap_discount'', 1, NULL, ''BRAND_MANAGER_OF_RECORD'', NULL, NULL),
  (''aps_discount_2'', ''ap_discount'', 2, NULL, ''ROLE'', ''Head of Sales'', ''{"all":[{"field":"discountPct","op":"gt","value":"$escalationPct"}]}''),
  (''aps_brand_old'', ''ap_brand_change'', 1, ''old'', ''BRAND_MANAGER_OF_RECORD'', NULL, NULL),
  (''aps_brand_new'', ''ap_brand_change'', 1, ''new'', ''BRAND_MANAGER_OF_NEW_BRAND'', NULL, NULL),
  (''aps_transfer_rsm'', ''ap_owner_transfer'', 1, ''any'', ''RSM'', NULL, NULL),
  (''aps_transfer_bm'', ''ap_owner_transfer'', 1, ''any'', ''BRAND_MANAGER_OF_RECORD'', NULL, NULL)
  ON CONFLICT DO NOTHING;

-- Seed: workflow rules (BUSINESS_CONTEXT 10)
INSERT INTO "WorkflowRule" (id, key, name, description, module, trigger, "triggerConfig", criteria, actions, "updatedAt") VALUES
  (''wf_quote_brand'', ''quote-inherits-brand'', ''Quote inherits brand and region from its deal'',
   ''Safety net: a quote always carries the brand and region of its deal.'',
   ''quotes'', ''ON_CREATE'', ''{}'', ''{}'', ''[{"type":"CALL_FUNCTION","name":"copyBrandFromDeal"}]'', now()),
  (''wf_order_brand'', ''order-inherits-brand'', ''Sales order inherits brand and region from its deal'',
   ''Safety net: a sales order always carries the brand and region of its deal.'',
   ''salesOrders'', ''ON_CREATE'', ''{}'', ''{}'', ''[{"type":"CALL_FUNCTION","name":"copyBrandFromDeal"}]'', now()),
  (''wf_stale_deal'', ''stale-deal'', ''Deal not updated for 7 days'',
   ''Task for the owner and a notification to the Brand Manager.'',
   ''deals'', ''SCHEDULED'', ''{"repeat":"PER_UPDATE"}'',
   ''{"all":[{"field":"isOpen","op":"eq","value":true},{"field":"updatedAt","op":"olderThanDays","value":7}]}'',
   ''[{"type":"CREATE_TASK","subject":"Follow up: deal not updated for 7 days","dueInHours":24,"assignee":"OWNER","priority":"HIGH"},{"type":"SEND_NOTIFICATION","to":"BRAND_MANAGER","title":"Deal not updated for 7 days: {{name}}"}]'', now()),
  (''wf_hot_lead'', ''hot-lead-escalation'', ''Hot lead not contacted in 2 hours'',
   ''Escalates to the Brand Manager.'',
   ''leads'', ''SCHEDULED'', ''{"repeat":"ONCE"}'',
   ''{"all":[{"field":"rating","op":"eq","value":"HOT"},{"field":"status","op":"eq","value":"NEW"},{"field":"createdAt","op":"olderThanHours","value":2}]}'',
   ''[{"type":"SEND_NOTIFICATION","to":"BRAND_MANAGER","title":"Hot lead not contacted in 2 hours: {{name}}"},{"type":"CREATE_TASK","subject":"Escalation: contact hot lead {{name}}","dueInHours":2,"assignee":"BRAND_MANAGER","priority":"HIGH"}]'', now()),
  (''wf_deal_won'', ''deal-won-follow-up'', ''Deal Closed Won follow-up'',
   ''Thank-you message task and an after-delivery follow-up call three days later.'',
   ''deals'', ''FIELD_CHANGE'', ''{"field":"stageId"}'',
   ''{"all":[{"field":"stageType","op":"eq","value":"WON"}]}'',
   ''[{"type":"CREATE_TASK","subject":"Send thank-you message","dueInHours":24,"assignee":"OWNER"},{"type":"CREATE_TASK","activityType":"CALL","subject":"After-delivery follow-up call","dueInHours":72,"assignee":"OWNER"}]'', now())
  ON CONFLICT DO NOTHING;';
END
$fn$;

SELECT app_seed_automation();

-- Existing discount requests join the seeded process.
UPDATE "ApprovalRequest" SET "processId" = 'ap_discount' WHERE kind = 'DISCOUNT';
