-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignType" ADD VALUE 'ADVERTISEMENT';
ALTER TYPE "CampaignType" ADD VALUE 'BANNER_ADS';
ALTER TYPE "CampaignType" ADD VALUE 'CONFERENCE';
ALTER TYPE "CampaignType" ADD VALUE 'DIRECT_MAIL';
ALTER TYPE "CampaignType" ADD VALUE 'EMAIL';
ALTER TYPE "CampaignType" ADD VALUE 'PARTNERS';
ALTER TYPE "CampaignType" ADD VALUE 'PUBLIC_RELATIONS';
ALTER TYPE "CampaignType" ADD VALUE 'REFERRAL_PROGRAM';
ALTER TYPE "CampaignType" ADD VALUE 'TELEMARKETING';
ALTER TYPE "CampaignType" ADD VALUE 'TRADE_SHOW';
ALTER TYPE "CampaignType" ADD VALUE 'WEBINAR';
ALTER TYPE "CampaignType" ADD VALUE 'OTHERS';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "actualCost" DECIMAL(14,2),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "expectedResponse" INTEGER,
ADD COLUMN     "expectedRevenue" DECIMAL(14,2),
ADD COLUMN     "numbersSent" INTEGER,
ADD COLUMN     "planStatus" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "category" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "glAccount" TEXT,
ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageMimeType" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "zipCode" TEXT;

