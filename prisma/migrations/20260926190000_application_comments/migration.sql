-- Adds a per-Application comment thread: a Comment can now optionally
-- belong to one specific Application (one university) instead of only
-- ever being part of a Task's general thread. Nothing existing changes —
-- every Comment row that exists today simply gets applicationId = NULL,
-- which is exactly what "general task thread" already means.
ALTER TABLE "Comment" ADD COLUMN "applicationId" TEXT;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Comment_applicationId_idx" ON "Comment"("applicationId");
