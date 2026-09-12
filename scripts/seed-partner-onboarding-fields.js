// One-time setup script — adds a starting set of custom onboarding
// fields specifically for Channel Partners (separate from Employee/
// Student's own set, via targetRole).
//
// Run this ONCE, from your Railway console, after deploying:
//   node scripts/seed-partner-onboarding-fields.js
//
// Safe to re-run: checks for an existing field by label (scoped to
// Channel Partner) before creating a new one, so running it twice
// won't create duplicates.
//
// These are a sensible starting set, not a fixed list - add, rename,
// or remove any of them anytime from Admin -> Website Content ->
// Onboarding Form Custom Fields -> Channel Partner section.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const fields = [
  { label: 'Business / Organization Name (if applicable)', fieldType: 'TEXT' },
  { label: 'GST Number (if applicable)', fieldType: 'TEXT' },
  { label: 'Preferred Communication Language', fieldType: 'TEXT' },
  { label: 'How Did You Hear About Us?', fieldType: 'TEXT' },
];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const existing = await prisma.onboardingFieldDefinition.findFirst({ where: { label: f.label, targetRole: 'CHANNEL_PARTNER' } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${f.label}`);
      skipped++;
      continue;
    }
    const maxOrder = await prisma.onboardingFieldDefinition.aggregate({ where: { targetRole: 'CHANNEL_PARTNER' }, _max: { sortOrder: true } });
    await prisma.onboardingFieldDefinition.create({
      data: { label: f.label, fieldType: f.fieldType, targetRole: 'CHANNEL_PARTNER', sortOrder: (maxOrder._max.sortOrder || 0) + 1, active: true },
    });
    console.log(`CREATED: ${f.label}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
