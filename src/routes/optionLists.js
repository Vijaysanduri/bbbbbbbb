// Fallback for the Admin-managed dropdown lists (Countries, Services,
// Case Types, Loan Statuses). Only mounted by src/index.js when the
// project has no dedicated route file for that list, so it never
// replaces an existing one. Same API the dashboards already call:
//   GET    /            (?includeInactive=1 to include retired items)
//   POST   /            { name }                 Admin/Super Admin
//   PATCH  /:id         { name?, order?, active? }  Admin/Super Admin
//   DELETE /:id                                    Admin/Super Admin
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();

function makeOptionRouter(delegateName, label) {
  const router = express.Router();
  const model = () => prisma[delegateName];

  router.get('/', requireAuth, async (req, res) => {
    const includeInactive = req.query.includeInactive === '1';
    const items = await model().findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  });

  router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: `A ${label} name is required.` });
    const existing = await model().findUnique({ where: { name } });
    if (existing) return res.status(400).json({ error: `A ${label} with this exact name already exists.` });
    const maxOrder = await model().aggregate({ _max: { order: true } });
    const created = await model().create({ data: { name, order: (maxOrder._max.order || 0) + 1 } });
    res.status(201).json(created);
  });

  router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    const { name, order, active } = req.body;
    const item = await model().findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: `${label} not found.` });
    const updated = await model().update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });
    res.json(updated);
  });

  router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    const item = await model().findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: `${label} not found.` });
    await model().delete({ where: { id: req.params.id } });
    res.json({ success: true });
  });

  return router;
}

module.exports = { makeOptionRouter };
