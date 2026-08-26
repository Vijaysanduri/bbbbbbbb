# Automated database backups to Google Drive — setup

Runs daily at 02:00 UTC via GitHub Actions, uploads a compressed Postgres
dump to a Google Drive folder you choose. **Nothing is ever deleted** —
every backup this has ever taken stays in the folder permanently, so you
can pull back any past day's data years from now if you ever need to
(compliance, former-employee records, audit purposes) — not just for
recent disaster recovery. You can also trigger a backup on demand any
time from the Actions tab.

This is a one-time setup — about 10 minutes. I can't do these steps for
you since they require your own Google account and GitHub repo access.

## 1. Create a Google Cloud service account

A service account lets the backup run unattended (no browser login) —
this is standard for automated systems.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
   and create a new project (or use an existing one) — name doesn't
   matter, e.g. "Dream2Fly Backups".
2. In the search bar, find **"Google Drive API"** and click **Enable**.
3. Go to **APIs & Services → Credentials → Create Credentials → Service
   Account**. Give it any name, e.g. `dream2fly-backup`. Skip the
   optional permission/role steps — none needed.
4. Open the service account you just created → **Keys** tab → **Add
   Key → Create new key → JSON**. This downloads a `.json` file —
   **keep it safe, it's effectively a password.**
5. Open that JSON file and copy the `client_email` value, something
   like `dream2fly-backup@your-project.iam.gserviceaccount.com`. You'll
   need this in step 3 below.

## 2. Create and share a Drive folder

1. In your own Google Drive, create a new folder — e.g. "Dream2Fly DB
   Backups".
2. Right-click it → **Share** → paste the `client_email` from step 1.4
   → give it **Editor** access → Send (you can ignore the "this isn't a
   real person" warning, that's expected for service accounts).
3. Open the folder and copy its **folder ID** from the URL:
   ```
   https://drive.google.com/drive/folders/1AbCdeFGhIJKlmnOPQrstuVWxyz
                                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                            this part is the folder ID
   ```

## 3. Add three secrets to your GitHub repo

In your **backend repo** on GitHub → **Settings → Secrets and variables
→ Actions → New repository secret**. Add these three:

| Secret name | Value |
|---|---|
| `DATABASE_URL` | Same Postgres connection string your app already uses (Railway → your Postgres service → Connect → copy the URL) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Open the JSON file from step 1.4, copy its **entire contents**, paste as the value |
| `DRIVE_BACKUP_FOLDER_ID` | The folder ID from step 2.3 |

## 4. Commit and test

1. Commit and push the new `.github/workflows/db-backup.yml` and
   `scripts/backup/` folder (already prepared) to your repo.
2. Go to the **Actions** tab on GitHub → **Database backup to Google
   Drive** → **Run workflow** (this is the manual trigger — you don't
   have to wait for 2am to test it).
3. Watch it run. If it succeeds, check your Google Drive folder — you
   should see a file like `dream2fly-backup-2026-08-24T...dump`.
4. If it fails, click into the failed step — the two most common causes
   are a typo in one of the three secrets, or the folder not actually
   being shared with the service account's exact email address.

From here it runs automatically every day at 02:00 UTC with zero
further action from you.

## Restoring from a backup

If you ever need to restore:

1. Download the `.dump` file from the Google Drive folder.
2. Run:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges \
     -d "YOUR_DATABASE_URL" dream2fly-backup-2026-08-24T...dump
   ```
   `--clean --if-exists` drops and recreates existing objects first, so
   this restores cleanly even against a database that already has data
   in it — but **this will overwrite whatever's currently in the target
   database**, so make sure `YOUR_DATABASE_URL` points at the right
   place (ideally test against a throwaway database first, not
   production, if you've never run this before).

## Changing the schedule

Edit the `cron:` line in `.github/workflows/db-backup.yml`. Cron times
are in UTC.

## A note on storage growth

Since nothing is ever deleted, the Drive folder grows by one file every
day, forever. At your current scale this is very cheap for a long time
(the free 15GB tier alone likely covers a couple of years), but it's
worth glancing at the folder's total size occasionally — Google Drive
shows this in the folder's details panel. If you ever do want to trim
very old backups manually, that's a manual decision you make by deleting
files directly in Drive; the script itself will never do this on its
own.
