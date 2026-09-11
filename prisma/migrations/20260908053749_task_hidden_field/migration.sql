-- AlterTable
-- If this column already exists (e.g. from an earlier partial deploy),
-- this migration will fail with "column already exists" - in that case,
-- run: npx prisma migrate resolve --applied 20260908053749_task_hidden_field
-- exactly as done previously in this project for similar situations.
ALTER TABLE "Task" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
