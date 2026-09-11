-- AlterTable
ALTER TABLE "PartnerProfile" ADD COLUMN "customValues" JSONB;

-- AlterTable
ALTER TABLE "OnboardingFieldDefinition" ADD COLUMN "targetRole" TEXT NOT NULL DEFAULT 'STAFF';
