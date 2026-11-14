'use strict';
const { randomBytes, createHash, timingSafeEqual } = require('crypto');
function token() { return randomBytes(32).toString('base64url'); }
function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function matches(value, expected) {
  if (typeof value !== 'string' || value.length > 100 || !expected) return false;
  return timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(expected, 'hex'));
}
module.exports = { token, hash, matches };
