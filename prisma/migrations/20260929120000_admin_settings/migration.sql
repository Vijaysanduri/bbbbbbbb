-- Purely additive: creates one new table, touches nothing existing.
-- Single row (id defaults to 'main') holds two admin-editable email
-- addresses (Confidential Notes alerts, monthly Tasks+Leads backup) and
-- a timestamp the backup scheduler uses to self-throttle to "once a
-- month" without needing a real cron library.
CREATE TABLE "AdminSetting" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "confidentialNotesAlertEmail" TEXT,
    "monthlyBackupEmail" TEXT,
    "lastMonthlyBackupAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("id")
);
