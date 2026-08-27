# Automated database backups to Google Drive — setup

Runs daily at 02:00 UTC via GitHub Actions, uploads a compressed Postgres
dump to a Google Drive folder you choose. **Nothing is ever deleted** —
every backup this has ever taken stays in the folder permanently, so you
can pull back any past day's data years from now if you ever need to
(compliance, former-employee records, audit purposes) — not just for
recent disaster recovery. You can also trigger a backup on demand any
time from the Actions tab.

## Why this uses OAuth2 instead of a service account key

The original plan used a Google service account with a downloadable
JSON key — the standard approach for unattended scripts. If you hit a
message like **"Service account key creation is disabled"** with an
error about an Organization Policy, that's Google's "Secure by
Default" setting, which many personal Google accounts now have
enforced automatically — and in practice there's often no toggle
available to turn it off yourself, even as the account's Owner.

This guide uses a different, equally valid credential type instead: an
OAuth2 **refresh token** tied to your own Google account. It isn't
affected by that policy at all, since it's not a service account key.
The tradeoff: the one-time setup has a couple more steps than the
service-account version would have, but nothing about how the backup
runs day-to-day is any different.

## 1. Create an OAuth Client in Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   same project you were already using (or a new one — either is fine).
2. Search bar → **"Google Drive API"** → **Enable** (skip if you
   already did this).
3. Left sidebar → **APIs & Services → OAuth consent screen**.
   - User type: **External**
   - Fill in the required fields (app name — anything, e.g. "Dream2Fly
     Backups"; your email for the two contact fields)
   - On the Scopes step, just click through — you don't need to add
     anything here
   - On the Test users step, **add your own Google account's email**
     as a test user — this matters, without it the next steps won't
     work
   - Save through to the end
4. Left sidebar → **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**.
   - Application type: **Desktop app**
   - Name: anything, e.g. "Dream2Fly Backup CLI"
   - Click **Create**
5. A popup shows your **Client ID** and **Client Secret** — copy both
   somewhere safe, you'll need them twice (once now, once in step 3
   below).

## 2. Generate a refresh token (one-time, no coding)

This uses Google's own **OAuth Playground** tool.

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the **gear icon** (⚙️) top-right → check **"Use your own OAuth
   credentials"** → paste in the Client ID and Client Secret from step
   1.5 above → close the settings panel
3. On the left, in the box that says "Input your own scopes", paste:
   ```
   https://www.googleapis.com/auth/drive
   ```
   → click **Authorize APIs**
4. You'll be sent through a normal Google sign-in — sign in with the
   same Google account whose Drive you want backups to land in. You
   may see an "unverified app" warning since this is your own OAuth
   client, not a published app — click **Advanced → Go to (app name)
   (unsafe)** to proceed. This is expected and safe; it's your own
   credential talking to your own account.
5. Back on the OAuth Playground, click **"Exchange authorization code
   for tokens"**.
6. You'll now see a **Refresh token** field — copy that value. This is
   the one that goes in GitHub as a secret; it doesn't expire on its
   own the way the "Access token" above it does.

## 3. Create and share a Drive folder

1. In your own Google Drive, create a new folder — e.g. "Dream2Fly DB
   Backups."
2. Open it, copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/1AbCdeFGhIJKlmnOPQrstuVWxyz
                                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                            this part is the folder ID
   ```
   (No sharing step needed this time — since the backup authenticates
   as *you*, it already has access to anything in your own Drive.)

## 4. Add 5 secrets to your GitHub repo

In your **backend repo** on GitHub → **Settings → Secrets and variables
→ Actions → New repository secret**. Add these five:

| Secret name | Value |
|---|---|
| `DATABASE_URL` | Same Postgres connection string your app already uses (Railway → your Postgres service → Connect → copy the URL) |
| `GOOGLE_OAUTH_CLIENT_ID` | From step 1.5 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From step 1.5 |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | From step 2.6 |
| `DRIVE_BACKUP_FOLDER_ID` | The folder ID from step 3 |

## 5. Commit and test

1. Commit and push `.github/workflows/db-backup.yml` and the
   `scripts/backup/` folder to your repo (already prepared for you).
2. Go to the **Actions** tab on GitHub → **Database backup to Google
   Drive** → **Run workflow** — this is the manual trigger, you don't
   have to wait for 2am to test it.
3. Watch it run. If it succeeds, check your Google Drive folder — you
   should see a file like `dream2fly-backup-2026-08-26T...dump`.
4. If it fails, click into the failed step:
   - A typo in one of the 5 secrets is the most common cause
   - If it specifically complains about the token being invalid or
     expired, you may need to redo step 2 — refresh tokens from an
     app still in "Testing" mode (rather than "Published") in the
     OAuth consent screen can expire after 7 days of no use; if that
     becomes a repeated issue, go back to the OAuth consent screen
     settings and publish the app (you don't need Google's review for
     this — an unpublished/unverified app works fine indefinitely once
     you've used it, this limit is specifically about *unused* test
     tokens expiring)

From here it runs automatically every day at 02:00 UTC with zero
further action from you.

## Restoring from a backup

See `RESTORE_GUIDE.md` for the full step-by-step process.

## Changing the schedule

Edit the `cron:` line in `.github/workflows/db-backup.yml`. Cron times
are in UTC.

## A note on storage growth

Since nothing is ever deleted, the Drive folder grows by one file every
day, forever. At your current scale this is very cheap for a long time
(the free 15GB tier alone likely covers a couple of years), but it's
worth glancing at the folder's total size occasionally — Google Drive
shows this in the folder's details panel.
