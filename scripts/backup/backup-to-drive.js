// Dream2Fly — automated database backup to Google Drive.
//
// AUTH METHOD: OAuth2 with a refresh token tied to your own Google
// account — not a service account key. Google's "Secure by Default"
// policy blocks service account key downloads on many personal
// accounts (with no way to override it, even as the account's Owner),
// so this uses a different, equally valid credential type that isn't
// affected by that restriction at all. See BACKUP_SETUP.md for how to
// generate the refresh token (one-time, via Google's own OAuth
// Playground — no coding involved).
//
// What this does, every time it runs:
//   1. Runs pg_dump against DATABASE_URL, producing a compressed,
//      pg_restore-compatible dump file (not plain SQL — smaller, and
//      restores cleanly with `pg_restore` regardless of table order).
//   2. Uploads it into a specific Google Drive folder, authenticating
//      as your own Google account via a long-lived refresh token
//      (safe to store as a GitHub secret — it can't be used to log
//      into your account directly, only to access Drive on its
//      behalf, and only for what its scope allows).
//
// Nothing is ever deleted — every backup this has ever taken stays in
// the Drive folder permanently, so any past day's data can be pulled
// back years later if it's ever needed (compliance / former-employee
// records / audit purposes), not just for recent disaster recovery.
//
// Runs from GitHub Actions on a schedule — see
// .github/workflows/db-backup.yml in the repo root. Can also be run by
// hand locally for a one-off backup, as long as the same environment
// variables are set (see BACKUP_SETUP.md).
//
// Required environment variables:
//   DATABASE_URL           — same Postgres connection string the app uses
//   GOOGLE_OAUTH_CLIENT_ID     — from the OAuth client you create in Google Cloud Console
//   GOOGLE_OAUTH_CLIENT_SECRET — from that same OAuth client
//   GOOGLE_OAUTH_REFRESH_TOKEN — generated once via OAuth Playground
//   DRIVE_BACKUP_FOLDER_ID  — the Drive folder ID backups get uploaded into

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { google } = require('googleapis');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = requireEnv('GOOGLE_OAUTH_REFRESH_TOKEN');
  const folderId = requireEnv('DRIVE_BACKUP_FOLDER_ID');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `dream2fly-backup-${timestamp}.dump`;
  const dumpPath = path.join(os.tmpdir(), fileName);

  // --- 1. Dump the database ---------------------------------------------
  console.log(`Running pg_dump -> ${dumpPath} ...`);
  try {
    execSync(
      `pg_dump "${databaseUrl}" --format=custom --no-owner --no-privileges -f "${dumpPath}"`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error('pg_dump failed — aborting before touching Google Drive.');
    process.exit(1);
  }
  const sizeMb = (fs.statSync(dumpPath).size / (1024 * 1024)).toFixed(2);
  console.log(`Dump complete: ${sizeMb} MB`);

  // --- 2. Authenticate via OAuth2 (your own Google account) ---------------
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // --- 3. Upload it — this is a permanent, never-deleted archive ---------
  console.log('Uploading to Google Drive (kept permanently — nothing is ever auto-deleted)...');
  const uploadRes = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(dumpPath) },
    fields: 'id, name, createdTime',
  });
  console.log(`Uploaded: ${uploadRes.data.name} (id: ${uploadRes.data.id})`);

  // Clean up the local temp file — this just removes it from the GitHub
  // Actions runner's disk, which is thrown away after the job ends
  // regardless. It does not touch anything in Google Drive.
  fs.unlinkSync(dumpPath);
  console.log('Done.');
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});

