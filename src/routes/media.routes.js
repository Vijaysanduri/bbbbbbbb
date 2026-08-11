const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const MAX_SIZE_BYTES = 16 * 1024 * 1024; // 16MB — comfortably covers WhatsApp's own image/video limits

// POST /api/media/upload — any signed-in staff member. Body: { fileData
// (base64, no data: prefix), fileName, mimeType }. Returns a URL that
// WhatsApp Business API can fetch the file from directly — that's the
// whole reason this endpoint exists, since WhatsApp needs a real URL,
// not embedded bytes the way an email attachment works.
router.post('/upload', requireAuth, async (req, res) => {
  const { fileData, fileName, mimeType } = req.body;
  if (!fileData || !fileName || !mimeType) return res.status(400).json({ error: 'fileData, fileName, and mimeType are all required.' });
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  if (!isImage && !isVideo) return res.status(400).json({ error: 'Only image or video files are supported for WhatsApp attachments.' });
  const approxBytes = fileData.length * 0.75; // base64 is ~4/3 the size of the raw bytes
  if (approxBytes > MAX_SIZE_BYTES) return res.status(400).json({ error: 'File is too large — please keep WhatsApp attachments under 16MB.' });

  const asset = await prisma.mediaAsset.create({
    data: { fileName, mimeType, fileData, uploadedById: req.user.id },
  });
  const publicUrl = `${req.protocol}://${req.get('host')}/api/media/${asset.id}/raw`;
  res.status(201).json({ id: asset.id, url: publicUrl, fileName, mimeType });
});

// GET /api/media/:id/raw — deliberately NO auth. WhatsApp's servers
// (Twilio or whichever provider) fetch media directly from the URL
// given at send time — they have no way to send our app's Bearer token,
// so this can't require one. The id itself is an unguessable cuid, so
// this is "unlisted" rather than truly access-controlled, the same
// tradeoff most systems make for this exact kind of provider-fetched
// media URL.
router.get('/:id/raw', async (req, res) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.status(404).send('Not found.');
  const buffer = Buffer.from(asset.fileData, 'base64');
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${asset.fileName}"`);
  res.send(buffer);
});

module.exports = router;
