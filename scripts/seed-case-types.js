// One-time setup - seeds the initial case type list to match what was
// previously hardcoded, so existing Task records with these exact
// values keep matching correctly. Safe to re-run.
//
// Run once, from your Railway console, after deploying:
//   node scripts/seed-case-types.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const caseTypes = ['Student Visa', 'Work Visa'];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < caseTypes.length; i++) {
    const name = caseTypes[i];
    const existing = await prisma.caseTypeOption.findUnique({ where: { name } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${name}`);
      skipped++;
      continue;
    }
    await prisma.caseTypeOption.create({ data: { name, order: i + 1 } });
    console.log(`CREATED: ${name}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
