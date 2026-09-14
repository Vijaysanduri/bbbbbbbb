// One-time setup - seeds the initial country list to match what was
// previously hardcoded (UK, Canada, Australia, USA), so existing
// Lead/Task records with these exact values keep matching correctly.
// Safe to re-run - skips any country that already exists.
//
// Run once, from your Railway console, after deploying:
//   node scripts/seed-countries.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const countries = ['UK', 'Canada', 'Australia', 'USA'];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < countries.length; i++) {
    const name = countries[i];
    const existing = await prisma.countryOption.findUnique({ where: { name } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${name}`);
      skipped++;
      continue;
    }
    await prisma.countryOption.create({ data: { name, order: i + 1 } });
    console.log(`CREATED: ${name}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
