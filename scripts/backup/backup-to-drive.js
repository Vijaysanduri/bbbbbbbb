// Dream2Fly — automated database backup to Google Drive.
//
// What this does, every time it runs:
//   1. Runs pg_dump against DATABASE_URL, producing a compressed,
//      pg_restore-compatible dump file (not plain SQL — smaller, and
//      restores cleanly with `pg_restore` regardless of table order).
//   2. Uploads it into a specific Google Drive folder, using a Service
//      Account (no browser login involved — safe to run unattended in
//      GitHub Actions).
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
//   DATABASE_URL                — same Postgres connection string the app uses
//   GOOGLE_SERVICE_ACCOUNT_JSON — the full service-account JSON key, as one string
//   DRIVE_BACKUP_FOLDER_ID      — the Drive folder ID backups get uploaded into

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
  const serviceAccountJson = requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
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

  // --- 2. Authenticate with the service account --------------------------
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (err) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

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

