-- AlterTable
ALTER TABLE "PriceBook" ADD COLUMN     "description" TEXT,
ADD COLUMN     "naira" DECIMAL(14,2),
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "pricingModel" TEXT;

