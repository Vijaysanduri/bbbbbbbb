-- Gives every Application its own Case Type, Case Status, Stage, Fees,
-- Overview and Interview Notes fields, mirroring the fields Task already
-- has one-for-one, so a candidate juggling several universities can have
-- each application's case tracking updated independently instead of
-- sharing one set of overview fields across all of them.
--
-- Loan and Visa details deliberately stay Task-level only (one loan and
-- one visa per candidate, not one per university), so they are NOT
-- duplicated onto Application here.
--
-- Nothing on Task changes. This is purely additive.

ALTER TABLE "Application"
  ADD COLUMN "caseType" TEXT,
  ADD COLUMN "caseStatus" "TaskStatus",
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "fees" TEXT,
  ADD COLUMN "overview" TEXT,
  ADD COLUMN "interviewNotes" TEXT;

-- Backfill: every Task that doesn't already have at least one Application
-- row gets one created as "Application 1", copying over whatever is
-- currently sitting on the Task's own case fields — so existing cases
-- look and behave exactly the same as before, just now also visible as
-- "Application 1" for a candidate who later adds a second university.
-- Ids are generated here (not Prisma's cuid()) since this runs as raw
-- SQL — format doesn't matter, only uniqueness does.
INSERT INTO "Application" (
  "id", "taskId", "label", "institution", "program", "country", "intake", "applicationId", "status",
  "caseType", "caseStatus", "stage", "fees", "overview", "interviewNotes",
  "createdAt", "updatedAt"
)
SELECT
  'bkfl_' || md5(random()::text || clock_timestamp()::text || t."id"),
  t."id", 'Application 1', t."college", t."course", t."country", t."intake", t."applicationId", NULL,
  t."caseType", t."status", t."stage", t."fees", t."overview", t."interviewNotes",
  now(), now()
FROM "Task" t
WHERE NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."taskId" = t."id");
