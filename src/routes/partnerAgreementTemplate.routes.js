const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { DEFAULT_INTRO_TEXT, DEFAULT_CLAUSES } = require('../utils/partnerAgreementPdf');

const router = express.Router();
const prisma = new PrismaClient();

// Single-row table — everything lives under the fixed id "default"
// rather than one row per something, since there's only ever one
// current Channel Partner Agreement template. See
// partnerAgreementPdf.js and partnerAgreementDelivery.js for how this
// is actually used when an agreement is generated and sent.

// GET /api/partner-agreement-template — Admin/Super Admin only.
// Lazily creates the row from the built-in default wording the first
// time anyone opens the edit screen, so there's always something to
// show and save from - no separate seed step needed.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  let template = await prisma.partnerAgreementTemplate.findUnique({ where: { id: 'default' } });
  if (!template) {
    template = await prisma.partnerAgreementTemplate.create({
      data: {
        id: 'default',
        introText: DEFAULT_INTRO_TEXT,
        clauses: DEFAULT_CLAUSES.map(([title, text]) => ({ title, text })),
        updatedById: req.user.id,
      },
    });
  }
  res.json({ introText: template.introText, clauses: template.clauses, updatedAt: template.updatedAt });
});

// PUT /api/partner-agreement-template — Admin/Super Admin only.
// Body: { introText, clauses: [{ title, text }, ...] }
// Takes effect immediately for every Channel Partner Agreement
// generated from this point on ("Send Agreement" button, and the
// automatic send once a partner's profile is complete) — no deploy,
// no code change. Already-sent/signed agreements are completely
// unaffected, since each one was already saved as its own PDF at the
// time it was sent.
router.put('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { introText, clauses } = req.body;
  if (!introText || typeof introText !== 'string') {
    return res.status(400).json({ error: 'introText is required.' });
  }
  if (!Array.isArray(clauses) || clauses.length === 0 || clauses.some(c => !c || !c.title || !c.text)) {
    return res.status(400).json({ error: 'clauses must be a non-empty list of { title, text }.' });
  }
  const template = await prisma.partnerAgreementTemplate.upsert({
    where: { id: 'default' },
    create: { id: 'default', introText, clauses, updatedById: req.user.id },
    update: { introText, clauses, updatedById: req.user.id },
  });
  res.json({ introText: template.introText, clauses: template.clauses, updatedAt: template.updatedAt });
});

module.exports = router;
