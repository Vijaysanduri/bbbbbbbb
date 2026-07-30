const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/info-documents — anyone signed in can view/download.
router.get('/', requireAuth, async (req, res) => {
  const docs = await prisma.infoDocument.findMany({
    select: { id: true, title: true, category: true, fileName: true, mimeType: true, createdAt: true, uploadedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(docs);
});

// GET /api/info-documents/:id — includes the actual file data, for download/send.
router.get('/:id', requireAuth, async (req, res) => {
  const doc = await prisma.infoDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  res.json(doc);
});

// POST /api/info-documents — Admin/Super Admin only.
// Body: { title, category, fileName, mimeType, fileData } — fileData is base64.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { title, category, fileName, mimeType, fileData } = req.body;
  if (!title || !fileName || !fileData) {
    return res.status(400).json({ error: 'title, fileName and fileData are required.' });
  }
  const doc = await prisma.infoDocument.create({
    data: { title, category: category || 'Document', fileName, mimeType: mimeType || 'application/octet-stream', fileData, uploadedById: req.user.id },
  });
  res.status(201).json({ id: doc.id, title: doc.title, category: doc.category, fileName: doc.fileName });
});

// DELETE /api/info-documents/:id — Admin/Super Admin only. Nobody else can
// remove a document, per the requirement that these can't be deleted by
// regular employees.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const doc = await prisma.infoDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  await prisma.infoDocument.delete({ where: { id: doc.id } });
  res.json({ success: true });
});

// POST /api/info-documents/:id/send
// Body: { via: 'email'|'whatsapp'|'both', recipientEmail?, recipientPhone?, candidateName? }
// Sends the document as a real email attachment. For WhatsApp: sending an
// actual file requires the WhatsApp Business API's media-upload flow,
// which isn't wired up in the whatsapp.js stub yet — so for now this sends
// a text notice naming the document rather than the file itself. Flagging
// this honestly rather than pretending it attaches a file over WhatsApp.
router.post('/:id/send', requireAuth, async (req, res) => {
  const { via, recipientEmail, recipientPhone, candidateName } = req.body;
  const doc = await prisma.infoDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const name = candidateName || 'there';
  let mailResult = { delivered: false, skipped: true };
  let whatsAppResult = { delivered: false, skipped: true };

  if (via === 'email' || via === 'both') {
    if (!recipientEmail) return res.status(400).json({ error: 'recipientEmail is required to send by email.' });
    mailResult = await sendMail({
      to: recipientEmail,
      subject: `${doc.title} — Dream2Fly`,
      body: `Hi ${name},\n\nPlease find attached "${doc.title}" for your reference.\n\nBest,\nDream2Fly Team`,
      attachmentFileName: doc.fileName,
      attachmentBase64: doc.fileData,
      attachmentMimeType: doc.mimeType,
    });
  }
  if (via === 'whatsapp' || via === 'both') {
    if (!recipientPhone) return res.status(400).json({ error: 'recipientPhone is required to send by WhatsApp.' });
    whatsAppResult = await sendWhatsApp({
      to: recipientPhone,
      message: `Hi ${name}, this is Dream2Fly. We've sent you "${doc.title}" — please check your email, or ask your counsellor to resend it here once WhatsApp document sending is enabled.`,
    });
  }

  res.json({ mailResult, whatsAppResult });
});

module.exports = router;
