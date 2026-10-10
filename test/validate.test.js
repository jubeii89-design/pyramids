'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { message, cleanName } = require('../server/validate');
const { createLimiter, clientIp } = require('../server/limits');

test('names are stripped of markup, control and zero-width characters and capped', () => {
  assert.strictEqual(cleanName('<img src=x onerror=alert(1)>'), 'img src=x onerro');
  assert.strictEqual(cleanName('A\u0000B​C\nD'), 'ABC D');
  assert.strictEqual(cleanName('x'.repeat(100)).length, 16);
  assert.strictEqual(cleanName('   '), 'Player');
  assert.strictEqual(cleanName(null), 'Player');
  assert.strictEqual(cleanName({ toString() { return 'obj'; } }), 'obj');
});

test('join: lowercase code accepted and normalised, 5 letters rejected', () => {
  assert.strictEqual(message({ type: 'join', code: ' abcd ', name: 'Ann' }).msg.code, 'ABCD');
  assert.ok(message({ type: 'join', code: 'ABCDE', name: 'Ann' }).error);
  assert.ok(message({ type: 'join', code: 12, name: 'Ann' }).error);
});

test('play: bad squares, direction, and word length are rejected', () => {
  const ok = { type: 'play', r: 1, c: 2, dir: 'H', word: 'cat' };
  assert.deepStrictEqual(message(ok).msg, { type: 'play', r: 1, c: 2, dir: 'H', word: 'cat' });
  for (const bad of [
    { ...ok, r: '1' }, { ...ok, c: 1.5 }, { ...ok, r: 10 }, { ...ok, r: -1 },
    { ...ok, dir: 'X' }, { ...ok, word: 'ab' }, { ...ok, word: 'a'.repeat(500) }, { ...ok, word: 'ca7' },
    { ...ok, word: 5 }, { ...ok, gameId: 'g'.repeat(100) }, { ...ok, revision: 'x' },
    { ...ok, requestId: 'r'.repeat(41) }, { ...ok, requestId: {} }, { ...ok, requestId: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.ok(message(bad).error, JSON.stringify(bad).slice(0, 60));
  assert.strictEqual(message({ type: 'preview', r: 1, c: 2, dir: 'H', word: 'cat', requestId: 1 }).msg.requestId, 1);
  assert.strictEqual(message({ type: 'preview', r: 1, c: 2, dir: 'H', word: 'cat', requestId: '1' }).msg.requestId, '1');
});

test('unknown types, arrays and oversize credentials are rejected', () => {
  assert.ok(message({ type: 'drop_tables' }).error);
  assert.ok(message([]).error);
  assert.ok(message({ type: 'pass', token: 't'.repeat(101) }).error);
  assert.ok(message({ type: 'pass', token: 5 }).error);
  assert.ok(message({ type: 'pass' }).msg);
});

test('host_create resume code is validated', () => {
  assert.strictEqual(message({ type: 'host_create', resume: 'abcd' }).msg.resume, 'ABCD');
  assert.ok(message({ type: 'host_create', resume: 'ab1d' }).error);
  assert.strictEqual(message({ type: 'host_create' }).msg.resume, '');
});

test('limiter: 6th event in a window is refused, then allowed after the window', () => {
  let t = 0;
  const lim = createLimiter(() => t);
  for (let i = 0; i < 5; i++) assert.ok(lim.hit('host:1.2.3.4', 5, 60000));
  assert.ok(!lim.hit('host:1.2.3.4', 5, 60000));
  assert.ok(lim.hit('host:9.9.9.9', 5, 60000));
  t = 61000;
  assert.ok(lim.hit('host:1.2.3.4', 5, 60000));
});

test('limiter: blocked() reflects recorded failures; sockets per IP are capped', () => {
  const lim = createLimiter(() => 0);
  for (let i = 0; i < 10; i++) { assert.ok(!lim.blocked('guess:a', 10, 60000)); lim.hit('guess:a', 10, 60000); }
  assert.ok(lim.blocked('guess:a', 10, 60000));
  for (let i = 0; i < 3; i++) assert.ok(lim.connect('ip', 3));
  assert.ok(!lim.connect('ip', 3));
  lim.disconnect('ip');
  assert.ok(lim.connect('ip', 3));
});

test('client IP: forwarded header only trusted when TRUST_PROXY=1', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(clientIp(req, {}), '127.0.0.1');
  assert.strictEqual(clientIp(req, { TRUST_PROXY: '1' }), '7.7.7.7');
});
