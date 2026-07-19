const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('Password123!', 10);

  // One test account per role — same password for all, change before real use.
  const users = await Promise.all([
    prisma.user.upsert({ where: { email: 'admin@dream2fly.co.uk' }, update: {}, create: { fullName: 'Super Admin', email: 'admin@dream2fly.co.uk', passwordHash: password, role: 'SUPER_ADMIN', jobTitle: 'Super Admin' } }),
    prisma.user.upsert({ where: { email: 'ananya.rao@dream2fly.co.uk' }, update: {}, create: { fullName: 'Ananya Rao', email: 'ananya.rao@dream2fly.co.uk', phone: '+44 7700 900123', passwordHash: password, role: 'EMPLOYEE', jobTitle: 'Counsellor' } }),
    prisma.user.upsert({ where: { email: 'partner@globalreach.example' }, update: {}, create: { fullName: 'GlobalReach Partners', email: 'partner@globalreach.example', passwordHash: password, role: 'CHANNEL_PARTNER', jobTitle: 'Channel Partner' } }),
    prisma.user.upsert({ where: { email: 'rahul.sharma@example.com' }, update: {}, create: { fullName: 'Rahul Sharma', email: 'rahul.sharma@example.com', passwordHash: password, role: 'STUDENT', jobTitle: 'Applicant' } })
  ]);
  const employee = users[1];

  // Default feature flags for the Employee role — matches the six toggles
  // in the "Employee Portal — Feature Controls" admin panel.
  const flagKeys = ['excelUpload', 'aiAssistant', 'convertToTask', 'followupLogging', 'editPhone', 'resetPassword'];
  await Promise.all(flagKeys.map(key =>
    prisma.featureFlag.upsert({ where: { scope_key: { scope: 'EMPLOYEE', key } }, update: {}, create: { scope: 'EMPLOYEE', key, enabled: true } })
  ));

  // Sample leads — mirrors the hardcoded data in employee-dashboard.html
  // so the UI looks identical on first connect.
  const leadSeeds = [
    { name: 'Rahul Sharma', country: 'UK', service: 'Student Visa', source: 'WEBSITE', status: 'VISA_APPROVED',
      history: ['ENQUIRY_RECEIVED', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'OFFER_RECEIVED', 'VISA_FILED', 'VISA_APPROVED'],
      followUps: [{ type: 'CALL', note: 'Called Rahul Sharma to introduce Dream2Fly services and understand their requirements.' }],
      comments: ['CAS letter received, moved to visa filing.'] },
    { name: 'Meera Iyer', country: 'UK', service: 'Visit Visa', source: 'INSTAGRAM', status: 'OFFER_RECEIVED',
      history: ['ENQUIRY_RECEIVED', 'DOCUMENTS_PENDING', 'OFFER_RECEIVED'], followUps: [], comments: [] },
    { name: 'Priya Nair', country: 'Canada', service: 'Work Visa', source: 'COLLEGE', status: 'DOCUMENTS_PENDING',
      history: ['ENQUIRY_RECEIVED', 'DOCUMENTS_PENDING'],
      followUps: [{ type: 'MESSAGE', note: 'Reminded Priya Nair about the pending documents needed to move their application forward.' }],
      comments: ['Waiting on IELTS score card.'] },
    { name: 'Arjun Mehta', country: 'Australia', service: 'Tourist Visa', source: 'FACEBOOK', status: 'UNDER_REVIEW',
      history: ['ENQUIRY_RECEIVED', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'], followUps: [], comments: [] },
    { name: 'Vikram Singh', country: 'USA', service: 'Work Visa', source: 'REFERRAL', status: 'VISA_REFUSED',
      history: ['ENQUIRY_RECEIVED', 'DOCUMENTS_PENDING', 'VISA_FILED', 'VISA_REFUSED'],
      followUps: [{ type: 'CALL', note: 'Called Vikram Singh again after no response to check if they are still interested.' }],
      comments: ['Refused due to insufficient funds proof. Discussing reapplication.'] },
    { name: 'Sara Ali', country: 'UK', service: 'Student Visa', source: 'WALK_IN', status: 'ENQUIRY_RECEIVED',
      history: ['ENQUIRY_RECEIVED'], followUps: [], comments: [] }
  ];

  for (const seed of leadSeeds) {
    const existing = await prisma.lead.findFirst({ where: { name: seed.name } });
    if (existing) continue;
    await prisma.lead.create({
      data: {
        name: seed.name, country: seed.country, service: seed.service, source: seed.source, status: seed.status,
        assignedEmployeeId: employee.id,
        history: { create: seed.history.map(stage => ({ stage })) },
        followUps: { create: seed.followUps.map(f => ({ type: f.type, note: f.note })) },
        comments: { create: seed.comments.map(text => ({ text, authorId: employee.id })) }
      }
    });
  }

  const taskSeeds = [
    { title: 'Follow up — sponsor letter', related: 'Meera Iyer', country: 'UK', daysFromNow: 0, priority: 'HIGH', status: 'PENDING' },
    { title: 'Verify passport', related: 'Arjun Mehta', country: 'Australia', daysFromNow: 0, priority: 'MEDIUM', status: 'IN_PROGRESS' },
    { title: 'Call re: new referral', related: 'GlobalReach Partners', country: 'Canada', daysFromNow: 1, priority: 'LOW', status: 'PENDING' },
    { title: 'Prepare visa file', related: 'Rahul Sharma', country: 'UK', daysFromNow: -1, priority: 'HIGH', status: 'OVERDUE' }
  ];
  for (const seed of taskSeeds) {
    const existing = await prisma.task.findFirst({ where: { title: seed.title, related: seed.related } });
    if (existing) continue;
    const due = new Date();
    due.setDate(due.getDate() + seed.daysFromNow);
    await prisma.task.create({
      data: { title: seed.title, related: seed.related, country: seed.country, due, priority: seed.priority, status: seed.status, assignedEmployeeId: employee.id }
    });
  }

  console.log('Seed complete. Test accounts (password for all: Password123!):');
  users.forEach(u => console.log(`  ${u.role.padEnd(16)} ${u.email}`));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
