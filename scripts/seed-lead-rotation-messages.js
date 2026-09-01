// One-time setup script — creates a single "Lead Re-Engagement" automation
// rule with 15 rotating messages already loaded in, so you don't need to
// write content from scratch or add each one by hand through the UI.
//
// Run this ONCE, from your Railway console, after deploying:
//   node scripts/seed-lead-rotation-messages.js
//
// Safe to re-run: checks for an existing rule with this exact name
// before creating a new one, and checks for existing messages by
// subject before adding duplicates.
//
// This rule fires for any Lead who hasn't responded in 7 days, repeats
// daily until they convert, and rotates through whichever of these 15
// messages are currently in-season - the 3 intake ones only enter
// rotation during their real application window, the other 12 are
// evergreen and always eligible. You can add, edit, or remove any of
// these later from Admin -> Promotions -> Automation -> Manage Messages.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CTA_URL = 'https://dream2fly.co.uk/#contact';

// The rule's own message (position 0 in rotation) - kept simple since
// it's the very first thing a lead sees under this rule.
const RULE_DEFAULT = {
  subject: 'Everything You Need, Under One Roof',
  body: `Hi {name},

Studying abroad involves a lot of moving parts — but you don't have to figure it out alone. Dream2Fly handles the entire journey, end to end, so nothing falls through the cracks: admission guidance, education loan support, visa assistance, and pre-departure support.

From picking the right university to landing safely on campus, our team is with you at every single step — and it costs you nothing until you're actually enrolled.

Best,
Dream2Fly Team`,
};

// Positions 1-14, evergreen unless a month window is set.
const ADDITIONAL_MESSAGES = [
  {
    subject: 'A Team That Actually Answers the Phone',
    body: `Hi {name},

Choosing a study-abroad consultant is a big decision — and a lot of agencies disappear the moment things get complicated.

We stay involved from your first question all the way through visa approval and beyond, with real people you can actually reach, not a call center.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Free Guidance, From Day One',
    body: `Hi {name},

Our consultation costs you nothing — we only get paid once you're actually enrolled at your university, which means our goals are genuinely aligned with yours from the very start.

There's no pressure to commit to anything just by talking to us.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'More Destinations Than You Might Expect',
    body: `Hi {name},

UK, USA, Canada, Australia, Ireland, Germany, New Zealand, and across Europe — we work with private universities in all of these, so your options are broader than you might think.

If you're not sure which country fits you best, that's exactly the kind of question we help you work through.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Managing Costs While You Study',
    body: `Hi {name},

Many students work part-time alongside their studies — but the rules around how many hours you can work, and what counts as eligible work, vary a lot by country.

We walk you through exactly what's allowed under your specific visa, so you can plan your finances with confidence before you even leave.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'What Happens After You Graduate',
    body: `Hi {name},

A degree is only part of the picture — what you can do afterward matters just as much. Many of our destination countries offer post-study work permits, letting you gain real work experience once you finish.

We help you understand these options upfront, so your choice of country and course lines up with your longer-term plans, not just the next few years.

Best,
Dream2Fly Team`,
  },
  {
    subject: "Support That Doesn't Stop at the Visa",
    body: `Hi {name},

Getting the visa is a huge milestone — but landing in a new country for the first time can still feel overwhelming. We help arrange accommodation before you leave, and airport pickup so you're not navigating an unfamiliar city alone on day one.

It's one less thing to worry about while you're settling in.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Planning to Bring Your Spouse or Children?',
    body: `Hi {name},

Some countries allow eligible students to bring a spouse or children along on a dependent visa — but the rules on eligibility and required documents can be genuinely confusing.

If this applies to your situation, we help you understand exactly what's possible for your specific country and course, and guide you through the dependent application alongside your own.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'All the Countries We Can Take You To',
    body: `Hi {name},

We work with private universities across United Kingdom, USA, Canada, Australia, Ireland, Germany, New Zealand, France, Netherlands, Italy, Spain, and Poland — so wherever fits your goals, budget, and course best, we can guide you there.

Not sure which one's right for you? That's exactly the kind of conversation we're happy to have.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Study Abroad Without IELTS, PTE, or TOEFL',
    body: `Hi {name},

A lot of students put off studying abroad because of English proficiency exams like IELTS, PTE, or TOEFL — the preparation, the cost, the pressure of a single test score.

The good news: several universities across our partner countries accept students without these exams, through alternative pathways like MOI (Medium of Instruction) letters or university-specific assessments.

If an English test has been the thing holding you back, let's talk about your other options.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Your Complete Study Abroad Partner',
    body: `Hi {name},

Dream2Fly is a study-abroad consultancy guiding students through every step of the journey — from choosing the right university to settling in once you arrive.

We work with private universities across the UK, USA, Canada, Australia, Ireland, Germany, New Zealand, and Europe, and support you through admissions, visa applications, education loans, accommodation, and airport pickup.

Whatever stage you're at — just exploring, or ready to apply — we're here to help you figure out the right next step.

Best,
Dream2Fly Team`,
  },
  {
    subject: "Money Shouldn't Be What Stops You",
    body: `Hi {name},

Our guidance costs you nothing — we don't charge students anything for our services, from your first consultation all the way through enrollment.

And university fees don't have to come entirely out of pocket either — we help arrange education loans, so a strong academic profile can matter more than what's currently in your bank account.

A lot of students assume studying abroad is only for those who can pay everything upfront. For many of our students, that simply hasn't been true — the right loan and the right guidance can make it genuinely achievable.

Best,
Dream2Fly Team`,
  },
  // --- Seasonal (intake) messages below — these three have real
  // month windows, everything above is evergreen (year-round eligible) ---
  {
    subject: 'Universities Are Now Accepting January Applications',
    body: `Hi {name},

Applications for our upcoming January intake are open right now. This is a great option if you missed the September window, or want more time to prepare a strong application.

Seats fill faster than you'd expect — this intake has fewer course options than Autumn, so early applications matter.

If January is on your radar, let's get your application moving now, while your course of choice still has availability.

Best,
Dream2Fly Team`,
    activeFromMonth: 9, activeToMonth: 2, // Sept through Feb - wraps across the new year
  },
  {
    subject: 'September Is the Widest Range of Courses You\'ll See',
    body: `Hi {name},

September/October is the primary intake at almost every university we work with — nearly every course and program is available, which means the most choice for you.

Because it's the most popular intake, it's also the most competitive — applying early gives you first pick of courses and universities.

If you're aiming for this year's Autumn intake, now is the time to start — the earlier you apply, the more options stay open to you.

Best,
Dream2Fly Team`,
    activeFromMonth: 1, activeToMonth: 7, // Jan through Jul
  },
  {
    subject: 'May/June — A Good Fit for the Right Program',
    body: `Hi {name},

The Summer intake is smaller than the other two — only select universities offer it, mainly for foundation, pathway, or niche programs.

Because fewer universities participate, this intake works best if you already know exactly which program you're aiming for.

If a foundation or pathway program fits your plans, this intake might be exactly the right timing for you.

Best,
Dream2Fly Team`,
    activeFromMonth: 1, activeToMonth: 4, // Jan through Apr
  },
];

async function main() {
  let rule = await prisma.automationRule.findFirst({ where: { name: 'Lead Re-Engagement (Rotating)' } });
  if (!rule) {
    rule = await prisma.automationRule.create({
      data: {
        name: 'Lead Re-Engagement (Rotating)',
        targetAudience: 'LEAD',
        triggerType: 'LEAD_NO_RESPONSE_DAYS',
        triggerDays: 7,
        channel: 'EMAIL',
        subject: RULE_DEFAULT.subject,
        body: RULE_DEFAULT.body,
        ctaText: 'Continue My Application',
        ctaUrl: CTA_URL,
        repeatDaily: true,
        active: true,
      },
    });
    console.log('CREATED rule: Lead Re-Engagement (Rotating)');
  } else {
    console.log('Rule already exists — reusing it, only adding any missing messages below.');
  }

  let created = 0, skipped = 0;
  for (let i = 0; i < ADDITIONAL_MESSAGES.length; i++) {
    const m = ADDITIONAL_MESSAGES[i];
    const existing = await prisma.automationRuleMessage.findFirst({ where: { ruleId: rule.id, subject: m.subject } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${m.subject}`);
      skipped++;
      continue;
    }
    await prisma.automationRuleMessage.create({
      data: {
        ruleId: rule.id, order: i + 1,
        subject: m.subject, body: m.body,
        ctaText: 'Continue My Application', ctaUrl: CTA_URL,
        activeFromMonth: m.activeFromMonth || null,
        activeToMonth: m.activeToMonth || null,
      },
    });
    console.log(`CREATED: ${m.subject}` + (m.activeFromMonth ? ` (seasonal: months ${m.activeFromMonth}-${m.activeToMonth})` : ''));
    created++;
  }
  console.log(`\nDone — ${created} messages created, ${skipped} skipped (already existed). Rule has ${created + skipped + 1} total messages in rotation (including its own default).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
