// One-time setup script — creates all 18 Channel Partner promotional
// campaigns directly, so you don't need to fill out the "New Scheduled
// Campaign" form 18 times by hand.
//
// Run this ONCE, from your Railway console, after deploying:
//   node scripts/seed-partner-campaigns.js
//
// Safe to re-run: it checks for an existing campaign with the same
// subject before creating a new one, so running it twice won't create
// duplicates.
//
// SCHEDULING: each campaign fires once every 2 days, one after another,
// covering all 18 over 36 days — then the whole cycle repeats,
// indefinitely, forever. This uses a "CUSTOM_DAYS" frequency: each of
// the 18 records has scheduledAt staggered 2 days after the previous
// one, and intervalDays set to 36 (18 campaigns x 2 days), so once a
// given campaign fires, it doesn't fire again until the full lap
// through all 17 others has completed.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CTA_TEXT = 'View Your Referrals';
const CTA_URL = 'https://dream2fly.co.uk/partner-dashboard.html';
const CYCLE_LENGTH_DAYS = 36; // 18 campaigns x 2 days apart

const campaigns = [
  {
    subject: 'Every UK Referral Earns You Up to ₹100,000',
    body: `Hi {name},

Every candidate you refer who enrolls at a private UK university puts real money in your pocket — between ₹10,000 and ₹100,000, paid once their visa is approved and they've completed 30 days at their institution.

The UK is moving fast right now: flexible start dates and a straightforward visa process mean your referrals convert quickly.

Think of everyone you know who's mentioned the UK — a message from you today could mean commission in your account in a matter of weeks.

Best,
Dream2Fly Team`,
  },
  {
    subject: "USA Deadlines Are Approaching — Don't Miss Out on Commission",
    body: `Hi {name},

If you have a candidate considering the USA, timing directly affects your earnings — later applications mean lower odds of approval, and a candidate who doesn't get in means no commission for you.

Reach out to them today. A quick message now could be the difference between ₹10,000–₹100,000 in your account and a missed opportunity.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Ireland — An Easy Yes for Candidates Still Undecided',
    body: `Hi {name},

Got a candidate who hasn't settled on a country yet? Ireland is often the easiest "yes" — English-speaking, strong post-study work options, and a smooth process from application to enrollment.

Every successful referral still earns you ₹10,000–₹100,000, regardless of which country they choose — so an undecided candidate is still an earning opportunity, not a dead end.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'A Few Names on Your List Could Mean Real Commission This Month',
    body: `Hi {name},

Take a moment to think through your contacts — friends, relatives, former students — anyone who's mentioned studying abroad. Each one is a potential ₹10,000–₹100,000 in commission once they enroll and their visa is approved.

We're here to support every step once you send them our way. The only step that depends on you is the referral itself.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Closer Support Means Faster Referrals — and Faster Commission',
    body: `Hi {name},

Our Hyderabad and Vijayawada offices are here for direct, in-person support — if a candidate has questions you can't answer on the spot, bring them in and we'll help close it together.

The faster a referral moves through the process, the faster your commission lands.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Canada — Strong Appeal, Strong Commission',
    body: `Hi {name},

Candidates focused on long-term settlement and post-study work options tend to say yes to Canada quickly — which means a faster path from referral to your ₹10,000–₹100,000 commission.

If career outcomes are what your candidate cares about most, Canada is worth raising today.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Australia — A Different Pitch for the Right Candidate',
    body: `Hi {name},

Some candidates want something other than the usual UK/USA/Canada options — Australia's education system and quality of life make it an easy sell for the right person.

Same commission range applies: ₹10,000–₹100,000 once they're enrolled and their visa is approved.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Germany — A Strong Option for the Right Candidate',
    body: `Hi {name},

Germany is worth raising with candidates focused on strong technical and engineering programs — and for referrals to eligible private institutions, the same commission applies: ₹10,000–₹100,000 once they're enrolled and their visa is approved.

Worth a mention if you have candidates specifically interested in engineering, technical, or research-focused programs.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'New Zealand — An Overlooked Option Worth Raising',
    body: `Hi {name},

New Zealand rarely comes up first, which is exactly why it's worth mentioning — English-speaking, strong quality of life, and less competition for spots than the more commonly requested destinations.

Same commission range applies here too: ₹10,000–₹100,000 once your candidate is enrolled and their visa is approved.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Europe — More Options Than Just the UK',
    body: `Hi {name},

Beyond the UK, Europe offers strong options worth mentioning — France, the Netherlands, Italy, Spain, and Poland all have private institutions with genuinely competitive programs, often at a lower overall cost than other destinations.

For candidates open to exploring beyond the usual choices, Europe can be an easier and faster path to enrollment — and the same commission applies: ₹10,000–₹100,000 once they're enrolled and their visa is approved.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'A Quick Refresher — Exactly How Your Commission Works',
    body: `Hi {name},

A quick, practical refresher: commission becomes payable once two things happen — your candidate's visa is approved, and they've completed 30 days at their university. At that point, ₹10,000–₹100,000 lands in your account, depending on the university and country.

One thing worth remembering: commission only applies to private universities, not public or government-funded ones — worth keeping in mind when you're steering a candidate toward their options.

If you're ever unsure whether a specific case qualifies, just ask us directly.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'A Simple Way to Bring Up Dream2Fly With Someone New',
    body: `Hi {name},

Sometimes the hardest part isn't finding candidates — it's knowing how to bring it up naturally. A simple approach that works well: ask if they (or their kids) have thought about studying abroad, then just mention you work with a consultancy that handles the whole process end to end.

That's usually enough to start the conversation — we take it from there.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Intake Season Is Approaching — A Good Time to Reach Out',
    body: `Hi {name},

As a new intake season approaches, universities are actively reviewing applications — which means candidates who apply now have a real timing advantage over those who wait.

If you've been meaning to follow up with someone, this is a good week to actually do it.

Best,
Dream2Fly Team`,
  },
  {
    subject: "You're Not On Your Own With Any Referral",
    body: `Hi {name},

Every candidate you refer gets the same full support from our team — document guidance, application help, and visa support — from the moment you send them our way until they're enrolled.

Your job is just the introduction. We handle the rest.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'A Smart Way to Earn Extra — Alongside Your Career',
    body: `Hi {name},

Being a Channel Partner works well alongside a full-time career — there's no fixed hours, no targets, and no need to step away from your current work. You refer when it's convenient for you, and earn ₹10,000–₹100,000 per successful referral once your candidate is enrolled and their visa is approved.

Many of our most successful partners are working professionals who simply mention us to people in their own network — colleagues, friends, family — without it taking real time out of their day.

If you know someone considering studying abroad, that conversation alone could be worth real money to you.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'Turn Your Network Into Real Income',
    body: `Hi {name},

You already know people — colleagues, clients, friends, extended family. Some of them likely have kids, siblings, or relatives thinking about studying abroad, whether or not they've mentioned it to you directly.

A single introduction from you, if it leads to enrollment, earns ₹10,000–₹100,000 — no extra effort beyond the referral itself, and no impact on your regular work.

It's worth a mention next time it comes up naturally.

Best,
Dream2Fly Team`,
  },
  {
    subject: "Refer More, Earn More — It's That Simple",
    body: `Hi {name},

There's no cap on how much you can earn as a Channel Partner — the more candidates you refer who go on to enroll, the more you earn. Each one is worth ₹10,000–₹100,000, and there's no limit to how many you can refer.

If it's been a while since your last referral, this is a good moment to think back through your contacts again.

Best,
Dream2Fly Team`,
  },
  {
    subject: 'The Right 15 Referrals Could Be Worth a Car',
    body: `Hi {name},

Here's some real perspective: 15 successful referrals at the higher end of our commission range could add up to real money — enough for a car, in the right circumstances.

Every referral still earns you ₹10,000–₹100,000, and there's no cap on how many you can send our way.

Best,
Dream2Fly Team`,
  },
];

async function main() {
  let created = 0, skipped = 0;
  const startDate = new Date('2026-09-07T04:30:00Z'); // Monday, 10:00 AM IST
  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    const existing = await prisma.scheduledPromotion.findFirst({ where: { subject: c.subject } });
    if (existing) {
      console.log(`SKIPPED (already exists): ${c.subject}`);
      skipped++;
      continue;
    }
    const scheduledAt = new Date(startDate.getTime() + i * 2 * 24 * 60 * 60 * 1000); // staggered 2 days apart
    await prisma.scheduledPromotion.create({
      data: {
        subject: c.subject,
        body: c.body,
        recipientSource: 'CHANNEL_PARTNER',
        channel: 'email',
        frequency: 'CUSTOM_DAYS',
        intervalDays: CYCLE_LENGTH_DAYS,
        scheduledAt,
        ctaText: CTA_TEXT,
        ctaUrl: CTA_URL,
        active: true,
      },
    });
    console.log(`CREATED: ${c.subject} — first fires ${scheduledAt.toISOString().slice(0, 10)}, then every ${CYCLE_LENGTH_DAYS} days`);
    created++;
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped (already existed).`);
}

main()
  .catch((err) => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
