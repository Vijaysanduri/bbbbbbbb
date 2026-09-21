// One-time backfill: gives every EXISTING Task its own separate
// CandidateProfile (1:1, no auto-merging by email/phone — that was a
// deliberate decision, since two different people can share a family
// email or an agent's phone number, and auto-merging strangers together
// would be worse than doing no grouping at all).
//
// Safe to re-run: any Task that already has a profile (a row in
// CandidateProfileApplication) is skipped, so running this twice does
// not create duplicates.
//
// Does not read or write anything on the Task table itself — only
// reads Task rows (to know they exist and to copy the candidate's
// name/contact into the new profile) and writes to the two new tables.
//
// Run with:  node scripts/backfill-candidate-profiles.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({
    select: { id: true, related: true, contactEmail: true, contactPhone: true },
  });
  console.log(`Found ${tasks.length} existing tasks.`);

  const alreadyLinked = new Set(
    (await prisma.candidateProfileApplication.findMany({ select: { taskId: true } })).map((l) => l.taskId)
  );

  let created = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (alreadyLinked.has(task.id)) {
      skipped++;
      continue;
    }
    const profile = await prisma.candidateProfile.create({
      data: {
        fullName: task.related || 'Unnamed candidate',
        contactEmail: task.contactEmail || null,
        contactPhone: task.contactPhone || null,
      },
    });
    await prisma.candidateProfileApplication.create({
      data: { profileId: profile.id, taskId: task.id },
    });
    created++;
  }

  console.log(`Done. Created ${created} new profiles, skipped ${skipped} tasks that already had one.`);
  console.log('Every task now has its own profile. To combine tasks that belong to the same real');
  console.log('person (e.g. Harika\'s East London and Northumbria applications), use the merge tool:');
  console.log('POST /profiles/merge  { "keepProfileId": "...", "mergeProfileId": "..." }');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
