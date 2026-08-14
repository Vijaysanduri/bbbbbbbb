// Short-lived, single-use view links — lets non-PDF/image documents
// (Word, Excel, etc.) be rendered inline via Google's public document
// viewer, without permanently exposing the underlying document at a
// public URL. A token is only ever generated for someone who already
// passed normal authentication to view that specific document, expires
// in 5 minutes, and is deleted the moment it's actually used — so even
// if a link leaked, the window to misuse it is tiny and single-shot.
//
// In-memory (a Map, not a database table) is the right call here: these
// are meant to be ephemeral by design, a server restart clearing them
// early is harmless, and it avoids persisting sensitive document bytes
// anywhere longer than necessary.

const crypto = require('crypto');

const tokens = new Map(); // token -> { fileData, fileName, mimeType, expiresAt }

function createTempViewToken(fileData, fileName, mimeType) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { fileData, fileName, mimeType, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumeTempViewToken(token) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { tokens.delete(token); return null; }
  return entry; // deliberately NOT deleted here — Google's viewer itself
  // needs to fetch the URL, so it must still be valid at fetch time; the
  // route handler below deletes it right after serving the bytes once.
}

function deleteTempViewToken(token) {
  tokens.delete(token);
}

// Periodic sweep for anything that expired but was never fetched (link
// copied but never opened, etc.) — keeps the Map from growing forever.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (now > entry.expiresAt) tokens.delete(token);
  }
}, 5 * 60 * 1000);

module.exports = { createTempViewToken, consumeTempViewToken, deleteTempViewToken };
