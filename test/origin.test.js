'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { originAllowed, inviteOrigin, assertConfigured } = require('../server/origin');

const req = (host, extra = {}) => ({ headers: { host, ...(extra.headers || {}) }, socket: { encrypted: !!extra.tls } });

test('PUBLIC_ORIGIN accepts its https browser origin and rejects others', () => {
  const env = { PUBLIC_ORIGIN: 'https://pyramids.example.com/' };
  assert.ok(originAllowed('https://pyramids.example.com', req('pyramids.example.com'), env));
  assert.ok(!originAllowed('http://pyramids.example.com', req('pyramids.example.com'), env));
  assert.ok(!originAllowed('https://evil.example', req('pyramids.example.com'), env));
});

test('several public origins can be listed', () => {
  const env = { PUBLIC_ORIGIN: 'https://a.example, https://b.example' };
  assert.ok(originAllowed('https://b.example', req('a.example'), env));
});

test('LAN mode accepts the same host only, over http or https', () => {
  const r = req('192.168.1.20:3000');
  assert.ok(originAllowed('http://192.168.1.20:3000', r, {}));
  assert.ok(originAllowed('https://192.168.1.20:3000', r, {}));
  assert.ok(!originAllowed('http://evil.example', r, {}));
  assert.ok(!originAllowed('not a url', r, {}));
});

test('a missing Origin (non-browser client) is allowed', () => {
  assert.ok(originAllowed(undefined, req('localhost:3000'), {}));
});

test('invite links use PUBLIC_ORIGIN, else the request host and scheme', () => {
  assert.strictEqual(inviteOrigin(req('x'), { PUBLIC_ORIGIN: 'https://p.example' }), 'https://p.example');
  assert.strictEqual(inviteOrigin(req('192.168.1.20:3000'), {}), 'http://192.168.1.20:3000');
  assert.strictEqual(inviteOrigin(req('h', { headers: { 'x-forwarded-proto': 'https' } }), { TRUST_PROXY: '1' }), 'https://h');
  assert.strictEqual(inviteOrigin(req('h', { headers: { 'x-forwarded-proto': 'https' } }), {}), 'http://h');
});

test('production refuses to start without PUBLIC_ORIGIN', () => {
  assert.throws(() => assertConfigured({ NODE_ENV: 'production' }), /PUBLIC_ORIGIN/);
  assert.doesNotThrow(() => assertConfigured({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://p.example' }));
  assert.doesNotThrow(() => assertConfigured({}));
});
