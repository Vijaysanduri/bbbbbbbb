-- Adds version history to SignableDocument so an agreement/document can
-- be replaced with a new version without disturbing anyone who already
-- signed or uploaded against the old one.
ALTER TABLE "SignableDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SignableDocument" ADD COLUMN "groupKey" TEXT;
ALTER TABLE "SignableDocument" ADD COLUMN "isCurrentVersion" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SignableDocument" ADD COLUMN "previousVersionId" TEXT;

ALTER TABLE "SignableDocument" ADD CONSTRAINT "SignableDocument_previousVersionId_key" UNIQUE ("previousVersionId");
ALTER TABLE "SignableDocument" ADD CONSTRAINT "SignableDocument_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "SignableDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
