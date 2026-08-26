PUSH THESE FILES TO YOUR BACKEND GITHUB REPO
==============================================

This is the FINAL, complete, verified set — every file passed a fresh
syntax check, the database schema passed a full integrity check, and
every feature built across the whole project was individually
confirmed still present, immediately before this package was built.

Unzip this folder, then copy everything inside it into your backend
repo — it already matches your repo's folder structure, so files just
land in the right place. Overwrite anything that already exists.

FILES THAT REPLACE EXISTING ONES:
- src/index.js
- src/routes/tasks.routes.js
- src/routes/auth.routes.js
- src/routes/leads.routes.js
- src/utils/mailer.js
- prisma/schema.prisma
- package.json

FILES THAT ARE NEW (don't exist in your repo yet):
- src/routes/dashboard.routes.js
- src/utils/formatting.js
- MIGRATION_GUIDE.md
- BACKUP_SETUP.md
- RESTORE_GUIDE.md
- scripts/backup/backup-to-drive.js
- scripts/backup/package.json
- scripts/fix-task-candidate-names.js
- .github/workflows/db-backup.yml

DEPLOY THIS FIRST — before uploading the Hostinger frontend files —
so the frontend isn't talking to a backend that doesn't have the new
routes yet.

AFTER YOU PUSH — 3 THINGS YOU STILL NEED TO DO:

1. Database change needs a real migration (not the old db push method).
   Open MIGRATION_GUIDE.md and follow it — then run:
   npx prisma migrate dev --name dream2fly_full_sync

2. Automated backups need one-time setup (Google Drive account +
   3 GitHub secrets). Open BACKUP_SETUP.md and follow it.

3. Fix existing task candidate names that were saved before this update
   (things like "AJMEERA NAGENDRA PRASAD" or "Ragi.Harika"). Run:
     node scripts/fix-task-candidate-names.js
   This only PRINTS what it would change — review it, then run again
   with --apply to actually save the fixes:
     node scripts/fix-task-candidate-names.js --apply

Everything else just works once pushed — no extra steps.
