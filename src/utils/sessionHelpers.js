const ms = require('ms');

// A session with no logoutAt isn't necessarily still active — it just
// means nobody explicitly clicked Logout. Their JWT token itself
// expires after JWT_EXPIRES_IN regardless, so past that point they're
// not actually logged in anymore even if we never recorded it.
//
// jsonwebtoken's own rule for `expiresIn`: a bare number means SECONDS;
// a string like "8h" gets parsed by the `ms` package. Those two don't
// agree on what a bare number means (`ms("3600")` is 3.6 SECONDS, not
// an hour) — matching jsonwebtoken's actual behavior here, not ms's,
// since that's what really determines when the token expires.
function parseTokenLifetimeMs(raw) {
  if (/^\d+$/.test(String(raw).trim())) return parseInt(raw, 10) * 1000;
  return ms(raw);
}

const TOKEN_LIFETIME_MS = parseTokenLifetimeMs(process.env.JWT_EXPIRES_IN || '8h');

// Capped at token expiry — an abandoned session (never logged out,
// never logged back in either) never inflates a duration total past
// the point where the person could actually still be using the app.
function sessionEffectiveEnd(session) {
  if (session.logoutAt) return session.logoutAt;
  const tokenExpiry = new Date(session.loginAt.getTime() + TOKEN_LIFETIME_MS);
  return tokenExpiry < new Date() ? tokenExpiry : new Date();
}

function sessionIsActuallyOpen(session) {
  if (session.logoutAt) return false;
  return session.loginAt.getTime() + TOKEN_LIFETIME_MS > Date.now();
}

module.exports = { TOKEN_LIFETIME_MS, parseTokenLifetimeMs, sessionEffectiveEnd, sessionIsActuallyOpen };
