// Dream2Fly — create a real user account (run this to assign access to
// an actual employee or channel partner, instead of using the seeded demo
// accounts).
//
// Usage:
//   node scripts/create-user.js "Full Name" email@example.com Password123! ROLE
//
// ROLE must be one of: SUPER_ADMIN, ADMIN, MANAGER, HR, FINANCE,
// COUNSELLOR, VISA_OFFICER, DOCUMENTATION_OFFICER, EMPLOYEE,
// CHANNEL_PARTNER, STUDENT
//
// Examples:
//   node scripts/create-user.js "Priya Rao" priya.rao@dream2fly.co.uk "Str0ngPass!23" EMPLOYEE
//   node scripts/create-user.js "GlobalReach Partners" contact@globalreach.example "Str0ngPass!23" CHANNEL_PARTNER

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const VALID_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'FINANCE',
  'COUNSELLOR', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER',
  'EMPLOYEE', 'CHANNEL_PARTNER', 'STUDENT',
];

async function main() {
  const [fullName, email, password, role] = process.argv.slice(2);

  if (!fullName || !email || !password || !role) {
    console.error('Usage: node scripts/create-user.js "Full Name" email@example.com Password123! ROLE');
    console.error('Valid roles:', VALID_ROLES.join(', '));
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error('Invalid role "' + role + '". Valid roles: ' + VALID_ROLES.join(', '));
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error('A user with email ' + email + ' already exists (role: ' + existing.role + '). Use the update script or Prisma Studio to change their role or password instead.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { fullName, email, passwordHash, role, active: true },
  });

  console.log('Account created successfully:');
  console.log('  Name:  ' + user.fullName);
  console.log('  Email: ' + user.email);
  console.log('  Role:  ' + user.role);
  console.log('');
  console.log('Give these to the person: their email and the password you just set.');
  console.log('They can sign in at yoursite.com/login.html — they will land on the correct dashboard automatically based on their role.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
