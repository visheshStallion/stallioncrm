-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('VEHICLE', 'ACCESSORY', 'EXTENDED_WARRANTY', 'SERVICE_PACKAGE', 'INSURANCE');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_TRANSIT', 'IN_STOCK', 'RESERVED', 'SOLD');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bodyType" TEXT,
ADD COLUMN     "category" "ProductCategory" NOT NULL DEFAULT 'VEHICLE',
ADD COLUMN     "colours" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "engineCc" INTEGER,
ADD COLUMN     "fuel" TEXT,
ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "listPrice" DECIMAL(14,2),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "modelYear" INTEGER,
ADD COLUMN     "specSheetUrl" TEXT,
ADD COLUMN     "taxCode" TEXT NOT NULL DEFAULT 'VAT',
ADD COLUMN     "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
ADD COLUMN     "transmission" TEXT,
ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookEntry" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "maxDiscountPct" DECIMAL(5,2),
    "notes" TEXT,

    CONSTRAINT "PriceBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleStockRef" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "colour" TEXT,
    "location" TEXT,
    "status" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleStockRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBook_brandId_name_key" ON "PriceBook"("brandId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBookEntry_priceBookId_productId_key" ON "PriceBookEntry"("priceBookId", "productId");

-- CreateIndex
CREATE INDEX "VehicleStockRef_productId_status_idx" ON "VehicleStockRef"("productId", "status");

-- CreateIndex
CREATE INDEX "VehicleStockRef_dealId_idx" ON "VehicleStockRef"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleStockRef_brandId_vin_key" ON "VehicleStockRef"("brandId", "vin");

-- CreateIndex
CREATE INDEX "Product_brandId_active_idx" ON "Product"("brandId", "active");

-- AddForeignKey
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleStockRef" ADD CONSTRAINT "VehicleStockRef_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleStockRef" ADD CONSTRAINT "VehicleStockRef_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Brand-tagged master data: RLS limits it to the user's brands (layer 2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_brand(p_brand text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_scope_all() OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(nullif(current_setting('app.memberships', true), ''), '[]')::jsonb) AS m("brandId" text)
    WHERE m."brandId" = p_brand
  )
$$;

-- Enables RLS on a table with a "brandId" column: rows of the user's brands only (read and write).
CREATE OR REPLACE FUNCTION app_enable_brand_tag_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS brand_tag ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY brand_tag ON %s FOR ALL TO stallion_rls USING (app_has_brand("brandId")) WITH CHECK (app_has_brand("brandId"))',
    p_table);
END
$$;

SELECT app_enable_brand_tag_rls('"Product"');
SELECT app_enable_brand_tag_rls('"PriceBook"');
SELECT app_enable_brand_tag_rls('"VehicleStockRef"');

-- Entries follow their price book (the PriceBook policy applies inside the subquery).
ALTER TABLE "PriceBookEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_entry ON "PriceBookEntry" FOR ALL TO stallion_rls
  USING (EXISTS (SELECT 1 FROM "PriceBook" b WHERE b.id = "priceBookId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "PriceBook" b WHERE b.id = "priceBookId"));

-- A price book entry / stock reference may only point at a product of the same brand.
CREATE OR REPLACE FUNCTION app_same_brand_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner text;
  v_product text;
BEGIN
  SELECT "brandId" INTO v_product FROM "Product" WHERE id = NEW."productId";
  IF TG_TABLE_NAME = 'PriceBookEntry' THEN
    SELECT "brandId" INTO v_owner FROM "PriceBook" WHERE id = NEW."priceBookId";
  ELSE
    v_owner := NEW."brandId";
  END IF;
  IF v_product IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'The product belongs to another brand' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER price_entry_same_brand BEFORE INSERT OR UPDATE ON "PriceBookEntry"
FOR EACH ROW EXECUTE FUNCTION app_same_brand_product();
CREATE TRIGGER stock_same_brand BEFORE INSERT OR UPDATE ON "VehicleStockRef"
FOR EACH ROW EXECUTE FUNCTION app_same_brand_product();

-- Existing products: model / variant from the name.
UPDATE "Product" SET "model" = "name" WHERE "model" IS NULL;

-- Brand Managers manage their own brand's catalogue.
UPDATE "Profile"
SET permissions = permissions
  || jsonb_build_object('products', '{"read": true, "create": true, "edit": true, "export": true}'::jsonb)
  || jsonb_build_object('priceBooks', '{"read": true, "create": true, "edit": true, "export": true}'::jsonb)
WHERE name = 'Brand Manager';
