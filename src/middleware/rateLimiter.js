// A simple, dependency-free rate limiter — tracks attempts per IP in
// memory. Good enough for a single-instance deployment like this one;
// if this backend ever runs across multiple instances, this would need
// to move to a shared store (Redis) instead, since each instance would
// otherwise count separately.
function rateLimiter({ maxAttempts, windowMs, message }) {
  const attempts = new Map();

  // Periodically clear out stale entries so this doesn't grow forever.
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of attempts) {
      if (now > record.resetAt) attempts.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let record = attempts.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
    }
    record.count++;
    attempts.set(key, record);
    if (record.count > maxAttempts) {
      return res.status(429).json({ error: message || 'Too many attempts. Please try again in a few minutes.' });
    }
    next();
  };
}

module.exports = { rateLimiter };
