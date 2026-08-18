// One-time script — creates the Student and Channel Partner automation
// rules directly, with the exact content already written and approved.
// Run this once via Railway's Console (node scripts/seed-promo-rules.js),
// then delete it — it's not meant to run automatically on every deploy.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const studentBody = `Hi {name},

Thinking about studying abroad? Here's what makes the process genuinely easier with Dream2Fly:

✅ Zero Processing Fees — our guidance is completely free. You only pay for what the university or visa office actually requires, nothing extra to us.

✅ End-to-End University & Loan Support — we handle your university applications and guide you through the education loan process from start to finish.

✅ Travel & Accommodation Help — once your visa is approved, we assist with travel planning and finding accommodation, so you're not figuring it out alone in a new country.

✅ Part-Time Work Guidance — we help you understand your work rights and how to find part-time opportunities alongside your studies.

✅ All Countries Covered — UK, Canada, Australia, USA, and more — one team, every major destination.

14+ years of experience. 1000+ successful students. A high visa success ratio you can actually check with us.

Reply here or call us to get started — your counsellor is ready to help.

Best,
Team Dream2Fly`;

const partnerBody = `Hi {name},

Partner with Dream2Fly and turn your network into real income — with zero extra work on your end.

✅ Just Refer, We Handle the Rest — once you refer a student, our team takes care of the entire process: counselling, university applications, visa filing, everything.

✅ Earn ₹20,000–₹1,00,000 Per Successful Visa — your commission depends on the case, paid out once the visa is approved.

✅ Refer 10 Students, Earn Up to ₹5 Lakhs — the more you refer, the more you earn, with no upper limit on how many students you bring in.

✅ Full Visibility — track every referral's progress and your commission status from your own Partner dashboard, in real time.

Terms & conditions apply — full details shared once you're onboarded as a partner.

Interested? Reply here or call us to get started.

Best,
Team Dream2Fly`;

async function main() {
  const studentRule = await prisma.automationRule.create({
    data: {
      name: 'Re-engage cold student leads (7 days)',
      targetAudience: 'LEAD',
      triggerType: 'LEAD_NO_RESPONSE_DAYS',
      triggerDays: 7,
      channel: 'EMAIL',
      subject: 'Study Abroad, Without the Financial Stress — Here\'s How Dream2Fly Helps',
      body: studentBody,
      ctaText: 'Book Free Consultation',
      ctaUrl: 'https://dream2fly.co.uk/#contact',
      active: true,
    },
  });
  console.log('✔ Created Student automation rule:', studentRule.id);

  const partnerRule = await prisma.automationRule.create({
    data: {
      name: 'Re-engage inactive partners (14 days)',
      targetAudience: 'CHANNEL_PARTNER',
      triggerType: 'PARTNER_NO_REFERRAL_DAYS',
      triggerDays: 14,
      channel: 'EMAIL',
      subject: 'Refer Students, Earn ₹20,000–₹1,00,000 Per Successful Visa',
      body: partnerBody,
      ctaText: 'Refer a Student',
      ctaUrl: 'https://dream2fly.co.uk/#contact',
      active: true,
    },
  });
  console.log('✔ Created Channel Partner automation rule:', partnerRule.id);

  console.log('\nBoth rules created and active — they\'ll start running on the next background check (within 6 hours).');
  console.log('You can review, edit, pause, or delete either one from Admin → Promotions.');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
