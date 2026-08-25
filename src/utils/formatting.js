// Normalizes a name to Title Case regardless of how it was typed —
// "RAGI HARIKA", "ragi harika", and "rAgI hArIka" all become
// "Ragi Harika". Also treats periods/underscores between name parts as
// separators, same as a space — "Ragi.Harika" and "Ragi_Harika" both
// become "Ragi Harika" too. Used everywhere a task's candidate name
// ("related") gets written, so it's stored consistently no matter which
// staff member typed it or how it was formatted.
function toTitleCase(str) {
  return (str || '').trim().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { toTitleCase };
