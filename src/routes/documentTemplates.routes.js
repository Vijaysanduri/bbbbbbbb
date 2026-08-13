const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildMergeFieldValues, fillPlaceholders, fillDocxTemplate } = require('../utils/docTemplateUtils');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/document-templates — Admin/Super Admin/HR. The saved library.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const templates = await prisma.documentTemplate.findMany({
    select: { id: true, title: true, category: true, bodyType: true, docxFileName: true, createdAt: true, createdBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(templates);
});

// POST /api/document-templates — create a new saved template. Either
// bodyType "TEXT" (textBody required) or "DOCX" (docxFileName +
// docxFileData required, from an uploaded Word file).
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { title, category, bodyType, textBody, docxFileName, docxFileData } = req.body;
  if (!title || !category || !bodyType) return res.status(400).json({ error: 'title, category, and bodyType are required.' });
  if (bodyType === 'TEXT' && !textBody) return res.status(400).json({ error: 'textBody is required for a TEXT template.' });
  if (bodyType === 'DOCX' && (!docxFileName || !docxFileData)) return res.status(400).json({ error: 'A Word file is required for a DOCX template.' });
  const template = await prisma.documentTemplate.create({
    data: { title, category, bodyType, textBody: textBody || null, docxFileName: docxFileName || null, docxFileData: docxFileData || null, createdById: req.user.id },
  });
  res.status(201).json({ id: template.id, title: template.title, category: template.category, bodyType: template.bodyType });
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  await prisma.documentTemplate.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// GET /api/document-templates/:id/preview?personId=... — Admin/HR only.
// Fills the template with a specific person's data and returns the
// result WITHOUT saving anything — lets Admin check it looks right
// before actually sending it to that person.
router.get('/:id/preview', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const template = await prisma.documentTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  const person = await prisma.user.findUnique({ where: { id: req.query.personId } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });
  const values = buildMergeFieldValues(person);
  if (template.bodyType === 'TEXT') {
    return res.json({ bodyType: 'TEXT', filledText: fillPlaceholders(template.textBody, values) });
  }
  try {
    const filledDocxBase64 = await fillDocxTemplate(template.docxFileData, values);
    res.json({ bodyType: 'DOCX', fileName: template.docxFileName, filledDocxBase64 });
  } catch (err) {
    res.status(500).json({ error: 'Could not fill this Word template: ' + err.message });
  }
});

// POST /api/document-templates/:id/prepare-and-send — Admin/HR only.
// Body: { personId }. Fills the template for that person, then creates
// a real SignableDocument individually assigned to them — reuses the
// exact same sign/upload/acknowledge infrastructure and email that
// manually uploading a one-off document already goes through, rather
// than building a second, separate delivery system.
router.post('/:id/prepare-and-send', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { personId } = req.body;
  if (!personId) return res.status(400).json({ error: 'personId is required.' });
  const template = await prisma.documentTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  const person = await prisma.user.findUnique({ where: { id: personId } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const values = buildMergeFieldValues(person);
  let fileName, mimeType, fileData;
  if (template.bodyType === 'TEXT') {
    const filledText = fillPlaceholders(template.textBody, values);
    fileName = `${template.title.replace(/[^a-z0-9]+/gi, '-')}-${person.fullName.replace(/[^a-z0-9]+/gi, '-')}.txt`;
    mimeType = 'text/plain';
    fileData = Buffer.from(filledText, 'utf-8').toString('base64');
  } else {
    try {
      fileData = await fillDocxTemplate(template.docxFileData, values);
    } catch (err) {
      return res.status(500).json({ error: 'Could not fill this Word template: ' + err.message });
    }
    fileName = template.docxFileName || `${template.title}.docx`;
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  const doc = await prisma.signableDocument.create({
    data: { title: template.title, category: template.category, fileName, mimeType, fileData, createdById: req.user.id, targetRole: person.role, targetUserId: person.id },
  });
  await prisma.signableDocumentAck.create({ data: { documentId: doc.id, userId: person.id } });
  await sendMail({
    to: person.email,
    subject: `Action needed: ${template.title}`,
    body: `Hi ${person.fullName},\n\nA new ${template.category === 'AGREEMENT' ? 'agreement' : 'document'} "${template.title}" needs your signature. Please review and sign it from your portal.\n\nBest,\nDream2Fly HR`,
  });
  res.status(201).json({ id: doc.id, fileName });
});

module.exports = router;
