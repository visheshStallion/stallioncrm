-- DropForeignKey
ALTER TABLE "InventoryDocument" DROP CONSTRAINT "InventoryDocument_brandId_fkey";

-- DropForeignKey
ALTER TABLE "InventorySettings" DROP CONSTRAINT "InventorySettings_brandId_fkey";

-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_brandId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_brandId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_productId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleUnit" DROP CONSTRAINT "VehicleUnit_brandId_fkey";

-- DropForeignKey
ALTER TABLE "Vendor" DROP CONSTRAINT "Vendor_brandId_fkey";

-- DropForeignKey
ALTER TABLE "Warehouse" DROP CONSTRAINT "Warehouse_brandId_fkey";

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");


-- ---------------------------------------------------------------------------
-- Push subscriptions: own rows only
-- ---------------------------------------------------------------------------
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_own ON "PushSubscription" FOR ALL TO stallion_rls
  USING ("userId" = app_user_id()) WITH CHECK ("userId" = app_user_id());

-- ---------------------------------------------------------------------------
-- Global search (prompt 14): trigram indexes make "contains" searches on names, phones, e-mail addresses,
-- VINs and document numbers index scans. Visibility is NOT part of the index: every search still runs through
-- scopedDb + RLS, the index only finds candidate rows faster.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Lead_search_trgm" ON "Lead" USING gin ((coalesce("firstName", '') || ' ' || "lastName") gin_trgm_ops);
CREATE INDEX "Lead_lastName_trgm" ON "Lead" USING gin ("lastName" gin_trgm_ops);
CREATE INDEX "Lead_mobile_trgm" ON "Lead" USING gin ("mobile" gin_trgm_ops);
CREATE INDEX "Lead_email_trgm" ON "Lead" USING gin ("email" gin_trgm_ops);
CREATE INDEX "Deal_name_trgm" ON "Deal" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Deal_customerName_trgm" ON "Deal" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX "Deal_vin_trgm" ON "Deal" USING gin ("vinChassisNo" gin_trgm_ops);
CREATE INDEX "Account_name_trgm" ON "Account" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Contact_lastName_trgm" ON "Contact" USING gin ("lastName" gin_trgm_ops);
CREATE INDEX "Quote_number_trgm" ON "Quote" USING gin ("number" gin_trgm_ops);
CREATE INDEX "SalesOrder_number_trgm" ON "SalesOrder" USING gin ("number" gin_trgm_ops);
CREATE INDEX "Invoice_number_trgm" ON "Invoice" USING gin ("number" gin_trgm_ops);
CREATE INDEX "Case_number_trgm" ON "Case" USING gin ("number" gin_trgm_ops);
CREATE INDEX "Case_subject_trgm" ON "Case" USING gin ("subject" gin_trgm_ops);
CREATE INDEX "Product_name_trgm" ON "Product" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Product_code_trgm" ON "Product" USING gin ("code" gin_trgm_ops);
CREATE INDEX "VehicleUnit_vin_trgm" ON "VehicleUnit" USING gin ("vin" gin_trgm_ops);
CREATE INDEX "DocumentLine_vin_trgm" ON "DocumentLine" USING gin ("vin" gin_trgm_ops);
