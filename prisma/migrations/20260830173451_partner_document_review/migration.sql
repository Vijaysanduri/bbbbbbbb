-- AlterTable
ALTER TABLE "PartnerProfile" ADD COLUMN "panCardStatus" "PartnerDocStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "PartnerProfile" ADD COLUMN "panCardRejectionReason" TEXT;
ALTER TABLE "PartnerProfile" ADD COLUMN "aadharCardStatus" "PartnerDocStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "PartnerProfile" ADD COLUMN "aadharCardRejectionReason" TEXT;
