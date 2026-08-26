# Switching from `db push` to real migrations (do this once)

## Why

Your `start` script used to run this on **every single deploy**:

```
npx prisma db push --accept-data-loss && node src/index.js
```

`db push` force-syncs your live database to match `schema.prisma`, and
`--accept-data-loss` tells Prisma to go ahead even if that sync would
destroy data — silently, with no confirmation. Nothing has hit that yet,
but it's a standing risk for any future schema change (a renamed field, a
changed column type, a shortened text field) deployed without anyone
noticing the danger.

`prisma migrate deploy` replaces this with versioned, reviewed migration
files — nothing runs against your database that wasn't explicitly created
and checked in first.

I can't run these commands myself: this sandbox has no network access to
`binaries.prisma.sh` (where Prisma's engine binaries live) and no
connection to your production database. **You need to run the steps
below yourself**, from a machine that has both — your laptop, or a
one-off shell in Railway.

I've already updated `package.json` so this is safe to deploy at any
point in the process — `npm start` no longer touches the database at
all (previously it force-synced on every boot). New commands added:

- `npm run prisma:baseline` — the one-time step below
- `npm run prisma:deploy` — applies migrations; run this on future deploys
- `npm run start:legacy` — the old risky behavior, kept only as a fallback

## One-time steps (run against your PRODUCTION `DATABASE_URL`)

**1. Pull the latest code (including the updated `package.json`) and install:**
```bash
npm install
```

**2. Make sure `DATABASE_URL` in your shell points at production** — the
same database your live app currently uses. Double-check this before
continuing; the next step writes a row into that database.

**3. Run the baseline:**
```bash
npm run prisma:baseline
```
This does two things:
- Generates `prisma/migrations/0_init/migration.sql` — the full current
  schema as a single migration file, built by diffing `schema.prisma`
  against nothing. It does **not** touch your database.
- Marks that migration as already applied (`prisma migrate resolve
  --applied 0_init`) — this only writes one tracking row into a
  `_prisma_migrations` table Prisma creates; it does not run the SQL,
  since your tables already exist from `db push`. Your data is untouched.

**4. Verify:**
```bash
npx prisma migrate status
```
Should print `Database schema is up to date!`. If it says anything about
pending migrations or drift, stop and don't proceed — paste me the
output and I'll help you work out what happened before you go further.

**5. Commit the new `prisma/migrations/0_init/` folder to git.** This is
now your permanent migration history — never edit or delete it once
committed, same as you wouldn't rewrite past git commits.

**6. Update your deploy platform's start command** (Railway → Settings →
Deploy → Start Command) to:
```
npm run prisma:deploy && npm start
```
This applies any pending migrations, then boots the app. Safe to run on
every deploy from now on, since it only ever applies migrations that are
already committed and reviewed.

## Going forward: how to make future schema changes

Don't hand-edit the database and don't run `db push` again. Instead:

```bash
# 1. Edit prisma/schema.prisma with your change
# 2. Create + apply a migration locally (against a dev DB, ideally not production):
npx prisma migrate dev --name describe_your_change

# 3. Commit the new prisma/migrations/<timestamp>_describe_your_change/ folder
# 4. Deploy as normal — `npm run prisma:deploy` on the server applies it
```

This is what actually guarantees history (confidential notes, everything
else) survives every future deploy — schema changes become reviewable,
versioned files instead of a silent auto-sync.
