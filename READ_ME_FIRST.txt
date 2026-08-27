PUSH THESE FILES TO YOUR BACKEND GITHUB REPO
==============================================

This is the complete, current set — every file passed a fresh syntax
check and the database schema passed a full integrity check
immediately before this package was built.

Unzip this folder, then copy everything inside it into your backend
repo — it already matches your repo's folder structure, so files just
land in the right place. Overwrite anything that already exists.

FILES THAT REPLACE EXISTING ONES:
- src/index.js
- src/routes/auth.routes.js
- src/routes/leads.routes.js
- src/routes/tasks.routes.js
- src/routes/dashboard.routes.js
- src/utils/mailer.js
- src/utils/scheduler.js
- src/utils/formatting.js
- prisma/schema.prisma
- package.json
- BACKUP_SETUP.md (rewritten — uses a different Google auth method now,
  see note below)

FILES THAT ARE NEW (don't exist in your repo yet):
- src/utils/sessionHelpers.js
- MIGRATION_GUIDE.md
- RESTORE_GUIDE.md
- scripts/backup/backup-to-drive.js
- scripts/backup/package.json
- scripts/fix-task-candidate-names.js
- .github/workflows/db-backup.yml

DEPLOY THIS FIRST — before uploading the Hostinger frontend files.

AFTER YOU PUSH — 2 THINGS YOU STILL NEED TO DO:

1. Run the database migration (the schema has new changes — a new
   LoginSession table for login/logout tracking, among others):
     npx prisma migrate dev --name latest_sync

2. If you haven't already finished the Google Drive backup setup, it
   now uses a different method (OAuth refresh token, not a service
   account key — Google blocks service-account-key creation on many
   personal accounts). Follow BACKUP_SETUP.md from the top; if you
   already have a working GOOGLE_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN
   set up as GitHub secrets, nothing further is needed there.

Everything else just works once pushed — no extra steps.

WHAT'S NEW IN THIS BATCH (backend side):
- Login/logout history tracking (new LoginSession table + endpoints)
- Automatic candidate email safety net: retries on rate-limit/server
  errors, alerts staff if it still can't be delivered
- Daily reminder scheduler now runs at a fixed 7pm IST clock time
  instead of an arbitrary server-boot-relative interval
- A background job finalizes abandoned login sessions so hour totals
  never inflate forever
- Visa agent contact info stripped from what students' browsers receive
- Task list includes a computed "last candidate update" timestamp,
  powering the new admin filter and standup-list badges
