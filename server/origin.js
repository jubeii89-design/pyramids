'use strict';
// Which browser origins may open a game socket, and which origin invite links use.
//  - PUBLIC_ORIGIN (comma-separated, e.g. https://pyramids.example.com) is the
//    allow-list on the public internet. Always set it behind a TLS proxy.
//  - Without it (LAN play) a browser may connect only from the same host it
//    loaded the page from, over http or https, so a foreign site cannot drive
//    a player's socket.
// A missing Origin header means a non-browser client (the AI test harness),
// which has no ambient browser credentials to abuse.
function configured(env) {
  return String(env.PUBLIC_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function originAllowed(originHeader, req, env = process.env) {
  if (!originHeader) return true;
  const list = configured(env);
  if (list.length) return list.includes(originHeader);
  try { return new URL(originHeader).host === req.headers.host; } catch { return false; }
}

function inviteOrigin(req, env = process.env) {
  const list = configured(env);
  if (list.length) return list[0];
  const https = req.socket.encrypted || (env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
  return `${https ? 'https' : 'http'}://${req.headers.host}`;
}

// Internet mode must name its public origin; refuse to start without it.
function assertConfigured(env = process.env) {
  if (env.NODE_ENV === 'production' && !configured(env).length) {
    throw new Error('PUBLIC_ORIGIN must be set in production (e.g. PUBLIC_ORIGIN=https://pyramids.example.com).');
  }
}

module.exports = { originAllowed, inviteOrigin, assertConfigured };
