-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TASK', 'CALL', 'MEETING', 'TEST_DRIVE', 'EMAIL_LOG', 'WHATSAPP_LOG');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" "ActivityStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "participants" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT,
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "recurrence" TEXT,
    "completedAt" TIMESTAMP(3),
    "direction" TEXT,
    "durationSec" INTEGER,
    "phone" TEXT,
    "recordingUrl" TEXT,
    "disposition" TEXT,
    "brandId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "territoryId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestDrive" (
    "activityId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "productId" TEXT,
    "vehicleVin" TEXT,
    "vehiclePlate" TEXT,
    "location" TEXT NOT NULL DEFAULT 'SHOWROOM',
    "licenceChecked" BOOLEAN NOT NULL DEFAULT false,
    "licenceNumber" TEXT,
    "indemnitySigned" BOOLEAN NOT NULL DEFAULT false,
    "indemnityAttachmentId" TEXT,
    "odometerStart" INTEGER,
    "odometerEnd" INTEGER,
    "feedbackRating" INTEGER,
    "followUpAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestDrive_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_parentType_parentId_idx" ON "Activity"("parentType", "parentId");

-- CreateIndex
CREATE INDEX "Activity_ownerId_status_idx" ON "Activity"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Activity_brandId_regionId_idx" ON "Activity"("brandId", "regionId");

-- CreateIndex
CREATE INDEX "Activity_startAt_idx" ON "Activity"("startAt");

-- CreateIndex
CREATE INDEX "Activity_dueAt_idx" ON "Activity"("dueAt");

-- CreateIndex
CREATE INDEX "TestDrive_brandId_vehicleVin_idx" ON "TestDrive"("brandId", "vehicleVin");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestDrive" ADD CONSTRAINT "TestDrive_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestDrive" ADD CONSTRAINT "TestDrive_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Activities are brand-owned.
SELECT app_enable_brand_rls('"Activity"');

-- Test-drive details follow their activity.
ALTER TABLE "TestDrive" ENABLE ROW LEVEL SECURITY;
CREATE POLICY test_drive_activity ON "TestDrive" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "Activity" a WHERE a.id = "activityId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Activity" a WHERE a.id = "activityId"));

-- Notifications: only the recipient reads / updates them; anyone may create one for another user
-- (mentions, assignments), but cannot read it back.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON "Notification" FOR SELECT TO stallion_rls USING ("userId" = app_user_id());
CREATE POLICY notification_update ON "Notification" FOR UPDATE TO stallion_rls USING ("userId" = app_user_id()) WITH CHECK ("userId" = app_user_id());
CREATE POLICY notification_insert ON "Notification" FOR INSERT TO stallion_rls WITH CHECK (true);
CREATE POLICY notification_delete ON "Notification" FOR DELETE TO stallion_rls USING ("userId" = app_user_id());

-- ---------------------------------------------------------------------------
-- No double booking of a demo vehicle: two non-cancelled test drives of the same brand + VIN may not overlap.
-- The advisory lock serialises concurrent bookings of the same vehicle, so the check is race-free.
-- SECURITY DEFINER: the check must see bookings the current user cannot (other regions of the brand).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_test_drive_no_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."endAt" <= NEW."startAt" THEN
    RAISE EXCEPTION 'A test drive must end after it starts' USING ERRCODE = '23514';
  END IF;
  IF NEW."vehicleVin" IS NULL OR NEW."cancelled" THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW."brandId" || ':' || NEW."vehicleVin"));
  IF EXISTS (
    SELECT 1 FROM "TestDrive" t
    WHERE t."brandId" = NEW."brandId" AND t."vehicleVin" = NEW."vehicleVin" AND NOT t."cancelled"
      AND t."activityId" <> NEW."activityId"
      AND t."startAt" < NEW."endAt" AND NEW."startAt" < t."endAt"
  ) THEN
    RAISE EXCEPTION 'TEST_DRIVE_OVERLAP: this vehicle is already booked for a test drive in that time' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER test_drive_no_overlap BEFORE INSERT OR UPDATE ON "TestDrive"
FOR EACH ROW EXECUTE FUNCTION app_test_drive_no_overlap();
