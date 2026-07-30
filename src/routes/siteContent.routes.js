const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Sensible defaults — the public site falls back to these if Admin hasn't
// overridden a field yet, so the homepage never shows blank/broken content.
const DEFAULTS = {
  hero_heading_1: 'YOUR DREAM,',
  hero_heading_2: 'OUR MISSION',
  hero_subtext: 'Dream2Fly helps you Study, Work & Settle Abroad with expert guidance and end-to-end support.',
  contact_phone: '+91 90005 56593',
  contact_email: 'info@dream2fly.co.uk',
  location_1: 'Hyderabad',
  location_2: 'Vijayawada',
  location_3: 'London',
  social_facebook: 'https://www.facebook.com/',
  social_instagram: 'https://www.instagram.com/',
  social_twitter: 'https://www.twitter.com/',
  social_youtube: 'https://www.youtube.com/',
  about_heading: 'Your trusted partner for studying, working & settling abroad',
  about_paragraph_1: 'Dream2Fly Consulting Services Ltd. has spent over 14 years helping students and professionals turn their global ambitions into reality. From your first enquiry to landing in your new country, our counsellors guide you through every step — university and course selection, visa documentation, financing, and pre-departure preparation.',
  about_paragraph_2: 'With offices in Hyderabad, Vijayawada, and London, and partnerships with universities and institutions across the UK, Canada, Australia, and beyond, we\'ve supported over 1,000 successful placements with a consistently high visa approval rate.',
  logo_image: null,        // base64 data URL, or null to use the default file
  hero_skyline_image: null,
  hero_students_image: null,
};

// GET /api/site-content — public, no auth. The website reads this on load.
router.get('/', async (req, res) => {
  const row = await prisma.siteContent.findUnique({ where: { id: 'main' } });
  const saved = row ? JSON.parse(row.dataJson) : {};
  res.json({ ...DEFAULTS, ...saved });
});

// PUT /api/site-content — Admin/Super Admin only.
// Body: any subset of fields to update — merges with what's already saved,
// so Admin can change just one field at a time.
router.put('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const row = await prisma.siteContent.findUnique({ where: { id: 'main' } });
  const existing = row ? JSON.parse(row.dataJson) : {};
  const merged = { ...existing, ...req.body };
  await prisma.siteContent.upsert({
    where: { id: 'main' },
    update: { dataJson: JSON.stringify(merged) },
    create: { id: 'main', dataJson: JSON.stringify(merged) },
  });
  res.json({ ...DEFAULTS, ...merged });
});

module.exports = router;
