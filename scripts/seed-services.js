// One-time setup - seeds the initial service list to match what was
// previously hardcoded, so existing Lead records with these exact
// values keep matching correctly. Safe to re-run - skips any service
// that already exists.
//
// Run once, from your Railway console, after deploying:
//   node scripts/seed-services.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const services = ['Student Visa', 'Work Visa', 'Visiting Visa', 'Tourist Visa'];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < services.length; i++) {
    const name = services[i];
    const existing = await prisma.serviceOption.findUnique({ where: { name } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${name}`);
      skipped++;
      continue;
    }
    await prisma.serviceOption.create({ data: { name, order: i + 1 } });
    console.log(`CREATED: ${name}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
