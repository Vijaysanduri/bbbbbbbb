// One-time setup - seeds the initial loan status list to match what was
// previously hardcoded, so existing Task records with these exact
// values keep matching correctly. Safe to re-run.
//
// Run once, from your Railway console, after deploying:
//   node scripts/seed-loan-statuses.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const loanStatuses = ['Applied', 'Under Review', 'Approved', 'Disbursed', 'Rejected'];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < loanStatuses.length; i++) {
    const name = loanStatuses[i];
    const existing = await prisma.loanStatusOption.findUnique({ where: { name } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${name}`);
      skipped++;
      continue;
    }
    await prisma.loanStatusOption.create({ data: { name, order: i + 1 } });
    console.log(`CREATED: ${name}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
