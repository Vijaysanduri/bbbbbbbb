// One-time cleanup: normalizes the candidate name ("related") on every
// EXISTING task to Title Case, using the same rule now applied
// automatically to new tasks (see src/utils/formatting.js) — including
// treating periods/underscores between name parts as spaces, e.g.
// "Ragi.Harika" -> "Ragi Harika".
//
// This does NOT run automatically and does NOT run on every deploy —
// it's a manual, one-time fix for records created before that rule
// existed. Run it once, review the output, then you're done.
//
// SAFE BY DEFAULT: running this with no flags only PRINTS what would
// change — it does not touch your database. Add --apply to actually
// save the changes once you've reviewed the dry-run output.
//
// Usage:
//   node scripts/fix-task-candidate-names.js            (dry run — prints only)
//   node scripts/fix-task-candidate-names.js --apply     (actually updates)

const { PrismaClient } = require('@prisma/client');
const { toTitleCase } = require('../src/utils/formatting');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

async function main() {
  const tasks = await prisma.task.findMany({ select: { id: true, taskNumber: true, related: true } });
  console.log(`Checking ${tasks.length} task(s)...\n`);

  const changes = [];
  for (const t of tasks) {
    const fixed = toTitleCase(t.related);
    if (fixed !== t.related) {
      changes.push({ id: t.id, taskNumber: t.taskNumber, before: t.related, after: fixed });
    }
  }

  if (changes.length === 0) {
    console.log('Nothing to change — every task name is already normalized.');
    await prisma.$disconnect();
    return;
  }

  console.log(`${changes.length} task(s) would be updated:\n`);
  changes.forEach(c => {
    console.log(`  TSK-${String(c.taskNumber).padStart(4, '0')}:  "${c.before}"  ->  "${c.after}"`);
  });

  if (!APPLY) {
    console.log(`\nThis was a DRY RUN — nothing was changed.`);
    console.log(`Review the list above, then re-run with --apply to save these changes.`);
  } else {
    console.log(`\nApplying ${changes.length} update(s)...`);
    for (const c of changes) {
      await prisma.task.update({ where: { id: c.id }, data: { related: c.after } });
    }
    console.log('Done. All listed tasks have been updated.');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Script failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
