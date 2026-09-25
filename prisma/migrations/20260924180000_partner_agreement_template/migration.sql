-- Editable Channel Partner Agreement template — single row (id 'default').
CREATE TABLE "PartnerAgreementTemplate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "introText" TEXT NOT NULL,
    "clauses" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerAgreementTemplate_pkey" PRIMARY KEY ("id")
);
