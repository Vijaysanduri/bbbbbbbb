# Restoring from a backup — what to do if something goes wrong

Keep this open during an actual incident. Steps are in the order you
should do them — don't skip the "restore to a scratch database first"
step, even when it feels urgent. That step is what stops a bad restore
from turning one problem into two.

## About table order — you don't need to think about this

The backup script dumps with `--format=custom`, not plain SQL. This
format stores a dependency-ordered table of contents inside the file
itself — `pg_restore` reads that and inserts tables in the correct
order automatically (e.g. `User` before `Task`, since tasks reference
users). You never need to manually sequence anything.

## Step 1 — find the right backup

1. Open the Google Drive folder from `BACKUP_SETUP.md`.
2. Files are named `dream2fly-backup-<timestamp>.dump` — the timestamp
   is in the file name, so you can see exactly when each one was taken.
3. **Pick the most recent backup from *before* the problem started.**
   If something went wrong at 3pm today, you want yesterday's or this
   morning's backup, not the one from an hour ago (which may already
   contain the bad data).
4. Download that one file to your computer.

## Step 2 — restore to a scratch database first, not production

This is the step that matters most. Restoring straight into production
means if the backup is older than you thought, or something's subtly
wrong, you've now destroyed today's data *and* not fixed the problem.
Testing first costs you 5 extra minutes and removes basically all the
risk.

**Get a throwaway Postgres to restore into** — easiest options:
- Railway: add a second, temporary Postgres service to any project
  (few clicks, delete it when you're done), or
- Locally: `docker run -e POSTGRES_PASSWORD=test -p 5433:5432 -d postgres:16`

Either way, grab that scratch database's connection string — call it
`SCRATCH_DATABASE_URL` below.

**Restore into it:**
```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --single-transaction \
  -d "SCRATCH_DATABASE_URL" \
  dream2fly-backup-2026-08-24T02-00-00-000Z.dump
```

What these flags do:
- `--clean --if-exists` — drops existing objects before recreating them,
  so it restores cleanly even into a database that already has some
  schema in it.
- `--single-transaction` — the entire restore is one atomic operation.
  If anything fails partway through, Postgres rolls back everything —
  you never end up with a half-restored, inconsistent database.
- `--no-owner --no-privileges` — skips restoring role/permission
  metadata, which usually doesn't match between environments and isn't
  what you actually need back.

## Step 3 — check it actually worked

Before trusting it, look at a few things that would catch a bad or
truncated restore:
```bash
psql "SCRATCH_DATABASE_URL" -c "SELECT count(*) FROM \"User\";"
psql "SCRATCH_DATABASE_URL" -c "SELECT count(*) FROM \"Task\";"
psql "SCRATCH_DATABASE_URL" -c "SELECT related, due FROM \"Task\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```
Compare the counts against what you'd roughly expect. If a student
portal login or a specific task you know should exist is missing, this
isn't the backup you want — go back to Step 1 and try an earlier one.

## Step 4 — only now, point it at production

Once you're confident the scratch restore looks right, there are two
ways to actually bring it into production, depending on how bad things
are:

**A. Partial recovery** (most common — e.g. one bad record, not
everything): don't do a full restore into production at all. Instead,
manually copy just the specific rows you need from the scratch database
back into production using `psql` or Prisma Studio, e.g. recovering one
accidentally-deleted task rather than overwriting the whole database.

**B. Full recovery** (rare — genuine data loss / corruption across the
board): repeat the exact Step 2 command, but with `-d` pointed at your
real `DATABASE_URL` instead of the scratch one. This **replaces
everything currently in production** with what's in the backup — so
anything created or changed after that backup's timestamp is gone. Only
do this if that tradeoff is genuinely what you want.

## After restoring

1. Restart your Railway backend service so it reconnects cleanly.
2. Spot-check the app itself — log in, open a task, check the confidential notes history is intact.
3. If you did a full restore (option B), tell your team the exact cutoff
   time, since anyone who made changes after that point will need to
   redo them.
