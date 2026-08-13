// Dream2Fly — reusable document template merge-field engine.
//
// Supports two kinds of template:
//   TEXT — typed directly in the app, plain text/simple HTML with
//          {{placeholders}}. Filled with straightforward string
//          replacement — no external dependencies, fully reliable.
//   DOCX — an uploaded Word file that already has {{placeholders}}
//          written into it. A .docx is actually a ZIP archive; the
//          visible document text lives inside word/document.xml as
//          plain XML. This unzips the file, does placeholder
//          replacement directly on that XML text, then re-zips it.
//
// Known limitation with DOCX templates: Word sometimes splits what
// looks like one word across multiple internal <w:t> XML runs (this
// happens when autocorrect, spell-check, or certain formatting was
// active while typing) — if a {{placeholder}} gets split that way,
// this simple text-replacement approach won't find it, since the
// literal string "{{name}}" no longer appears intact anywhere in the
// XML. The fix on the template-creation side is straightforward:
// type each {{placeholder}} in one continuous typing motion with
// autocorrect off, which is how every doc-merge tool handles this
// same constraint. This does NOT affect TEXT templates at all, since
// those have no such internal run-splitting to worry about.

const JSZip = require('jszip');

// Builds the token → value map for one specific person. Add new tokens
// here and they immediately become available in every template, both
// TEXT and DOCX, with no other code changes needed.
function buildMergeFieldValues(person) {
  const today = new Date();
  return {
    name: person.fullName || '',
    email: person.email || '',
    phone: person.phone || '',
    jobTitle: person.jobTitle || '',
    role: person.role || '',
    date: today.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    company: 'Dream2Fly Consulting Services Ltd',
  };
}

// Replaces every {{token}} in a plain string with its value — used for
// TEXT templates directly, and for the inner replacement step DOCX
// templates also use once their XML content is extracted as a string.
function fillPlaceholders(text, values) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token) => {
    return Object.prototype.hasOwnProperty.call(values, token) ? String(values[token]) : match;
  });
}

// XML-escapes a value before it's inserted into document.xml — without
// this, a value containing &, <, or > would produce invalid, corrupted
// XML that Word can't open.
function xmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fillDocxTemplate(docxBase64, values) {
  const buffer = Buffer.from(docxBase64, 'base64');
  const zip = await JSZip.loadAsync(buffer);
  const docXmlPath = 'word/document.xml';
  const docXmlFile = zip.file(docXmlPath);
  if (!docXmlFile) {
    throw new Error('This doesn\'t look like a valid .docx file — word/document.xml is missing.');
  }
  const xml = await docXmlFile.async('string');
  const escapedValues = {};
  for (const [token, value] of Object.entries(values)) escapedValues[token] = xmlEscape(value);
  const filledXml = fillPlaceholders(xml, escapedValues);
  zip.file(docXmlPath, filledXml);
  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return outputBuffer.toString('base64');
}

module.exports = { buildMergeFieldValues, fillPlaceholders, fillDocxTemplate, xmlEscape };
