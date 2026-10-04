const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

// Self-throttles to "once every 30 days" using AdminSetting.lastMonthlyBackupAt
// — same check-often-act-rarely pattern as the existing reminder/SLA
// schedulers, so it naturally re-fires on schedule no matter when the
// server happens to restart, without needing a real cron library.
const BACKUP_INTERVAL_DAYS = 30;

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Flattens a list of plain objects into an ExcelJS worksheet — one column
// per key found across all rows (so a field that's only set on some
// records still gets its own column), header row bolded, dates and
// nested objects/arrays rendered as readable text rather than [object
// Object] or raw ISO strings.
function buildSheet(workbook, sheetName, rows) {
  const sheet = workbook.addWorksheet(sheetName);
  if (!rows.length) {
    sheet.addRow(['No records.']);
    return;
  }
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const flat = {};
    for (const key of columns) {
      const val = row[key];
      if (val === null || val === undefined) flat[key] = '';
      else if (val instanceof Date) flat[key] = val.toLocaleString();
      else if (typeof val === 'object') flat[key] = JSON.stringify(val);
      else flat[key] = val;
    }
    sheet.addRow(flat);
  }
}

async function buildTasksWorkbookBuffer() {
  const tasks = await prisma.task.findMany({ orderBy: { taskNumber: 'asc' } });
  const workbook = new ExcelJS.Workbook();
  buildSheet(workbook, 'Tasks', tasks);
  return workbook.xlsx.writeBuffer();
}

async function buildLeadsWorkbookBuffer() {
  const leads = await prisma.lead.findMany({ orderBy: { dateAdded: 'asc' } });
  const workbook = new ExcelJS.Workbook();
  buildSheet(workbook, 'Leads', leads);
  return workbook.xlsx.writeBuffer();
}

// Runs the actual export + email, unconditionally — used both by the
// throttled monthly check below and available to call manually/on demand
// later if ever needed.
async function runMonthlyBackupNow(destinationEmail) {
  const [tasksBuffer, leadsBuffer] = await Promise.all([
    buildTasksWorkbookBuffer(),
    buildLeadsWorkbookBuffer(),
  ]);

  const zip = new JSZip();
  const stamp = new Date().toISOString().slice(0, 10);
  zip.file(`Tasks-${stamp}.xlsx`, tasksBuffer);
  zip.file(`Leads-${stamp}.xlsx`, leadsBuffer);
  const zipBase64 = await zip.generateAsync({ type: 'base64' });

  await sendMail({
    to: destinationEmail,
    subject: `Dream2Fly monthly backup — Tasks & Leads (${stamp})`,
    body: `Attached is the automatic monthly backup of all Tasks and Leads, exported as of ${new Date().toLocaleString()}.\n\nThis is a full snapshot (not incremental) — every Task and every Lead currently in the system, each as its own Excel sheet inside the attached zip.`,
    attachmentFileName: `Dream2Fly-Backup-${stamp}.zip`,
    attachmentBase64: zipBase64,
    attachmentMimeType: 'application/zip',
  });
}

// Checked frequently (daily, same as the weekly-reminder scheduler) but
// only actually exports/sends once BACKUP_INTERVAL_DAYS have passed since
// the last run — and only if an admin has set a destination address in
// Settings. Never deletes or modifies any Task/Lead data; read-only export.
async function runMonthlyBackupCheck() {
  try {
    const settings = await prisma.adminSetting.findUnique({ where: { id: 'main' } });
    const destinationEmail = settings && settings.monthlyBackupEmail;
    if (!destinationEmail) return; // not configured yet — nothing to do

    const cutoff = daysAgo(BACKUP_INTERVAL_DAYS);
    const last = settings.lastMonthlyBackupAt;
    if (last && last > cutoff) return; // not due yet

    await runMonthlyBackupNow(destinationEmail);

    await prisma.adminSetting.upsert({
      where: { id: 'main' },
      update: { lastMonthlyBackupAt: new Date() },
      create: { id: 'main', lastMonthlyBackupAt: new Date() },
    });
    console.log(`[backupScheduler] Monthly Tasks+Leads backup sent to ${destinationEmail}.`);
  } catch (err) {
    console.error('[backupScheduler] Monthly backup run failed:', err.message);
  }
}

module.exports = { runMonthlyBackupCheck, runMonthlyBackupNow };
