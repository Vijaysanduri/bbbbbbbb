// One-time setup script — adds the missing fields your Personal Info &
// Bank Details Form needs (Gender, Marital Status, Bank Details, PAN,
// Aadhaar, UAN) as custom onboarding fields.
//
// Run this ONCE, from your Railway console, after deploying:
//   node scripts/seed-onboarding-fields.js
//
// Safe to re-run: checks for an existing field by exact label before
// creating a new one, so running it twice won't create duplicates.
//
// No frontend changes were needed for this — the Onboarding Form
// already renders and saves whatever custom fields exist here.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const fields = [
  // Personal Details
  { label: 'Gender', fieldType: 'TEXT' },
  { label: 'Marital Status', fieldType: 'TEXT' },
  { label: 'Nationality', fieldType: 'TEXT' },
  // Bank Account Details
  { label: 'Account Holder Name', fieldType: 'TEXT' },
  { label: 'Bank Name', fieldType: 'TEXT' },
  { label: 'Branch', fieldType: 'TEXT' },
  { label: 'Account Number', fieldType: 'TEXT' },
  { label: 'IFSC Code', fieldType: 'TEXT' },
  { label: 'Account Type (Savings/Current)', fieldType: 'TEXT' },
  // Statutory Details
  { label: 'PAN Number', fieldType: 'TEXT' },
  { label: 'Aadhaar Number', fieldType: 'TEXT' },
  { label: 'UAN (if previously employed)', fieldType: 'TEXT' },
];

async function main() {
  let created = 0, skipped = 0;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const existing = await prisma.onboardingFieldDefinition.findFirst({ where: { label: f.label } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${f.label}`);
      skipped++;
      continue;
    }
    await prisma.onboardingFieldDefinition.create({
      data: { label: f.label, fieldType: f.fieldType, sortOrder: i + 1, active: true },
    });
    console.log(`CREATED: ${f.label}`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
