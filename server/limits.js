'use strict';
// Per-IP abuse limits that a per-socket message limit cannot give: many
// sockets from one address creating rooms or guessing 4-letter codes.
function clientIp(req, env = process.env) {
  if (env.TRUST_PROXY === '1') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1]; // the hop our own proxy appended
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createLimiter(now = Date.now) {
  const hits = new Map(); // key -> [timestamps]
  const open = new Map(); // ip -> concurrent sockets
  const recent = (key, windowMs) => (hits.get(key) || []).filter((x) => now() - x < windowMs);
  return {
    // Records an event; false once `max` events already happened in `windowMs`.
    hit(key, max, windowMs) {
      const list = recent(key, windowMs);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(now()); hits.set(key, list);
      return true;
    },
    // True when `max` events are already on record (does not add one).
    blocked(key, max, windowMs) {
      return recent(key, windowMs).length >= max;
    },
    connect(ip, max) {
      const n = (open.get(ip) || 0) + 1;
      if (n > max) return false;
      open.set(ip, n);
      return true;
    },
    disconnect(ip) {
      const n = (open.get(ip) || 1) - 1;
      if (n <= 0) open.delete(ip); else open.set(ip, n);
    },
    prune(windowMs = 10 * 60 * 1000) {
      for (const k of [...hits.keys()]) {
        const keep = recent(k, windowMs);
        if (keep.length) hits.set(k, keep); else hits.delete(k);
      }
    },
  };
}

module.exports = { clientIp, createLimiter };
