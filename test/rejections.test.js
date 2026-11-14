'use strict';
// Every refusal carries a stable code, a short reason and a "what to try" hint.
const test = require('node:test');
const assert = require('node:assert');
const g = require('../server/game');

const DICT = new Set(['cat', 'all', 'tea', 'zzz']);

// An empty board with the real turn order, so each rule can be tested on its own.
function board(players = ['red', 'blue']) {
  const st = g.createGame(players);
  for (const row of st.cells) for (const cell of row) { cell.stack = []; cell.printed = null; }
  st.turn = 0;
  let id = 1000;
  st.put = (r, c, l, o) => st.cells[r][c].stack.push({ id: id++, l, v: 1, o });
  st.print = (r, c, l) => { st.cells[r][c].printed = l; };
  return st;
}
const play = (st, move) => g.planWord(st, 'red', { dir: 'H', ...move }, DICT);
const refused = (res, code) => {
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, code, `${res.code}: ${res.error}`);
  assert.ok(res.error && res.error.length > 5, 'has a reason');
  assert.ok(res.hint && res.hint.length > 20, 'has a hint');
  return res;
};

test('wrong turn, bad word, not a word, bad direction, no start square', () => {
  const st = board();
  refused(g.planWord(st, 'blue', { r: 5, c: 2, dir: 'H', word: 'cat' }, DICT), 'NOT_YOUR_TURN');
  refused(play(st, { r: 5, c: 2, word: 'at' }), 'BAD_WORD');
  refused(play(st, { r: 5, c: 2, word: 'c4t' }), 'BAD_WORD');
  const nw = refused(play(st, { r: 5, c: 2, word: 'qxqx' }), 'NOT_A_WORD');
  assert.match(nw.error, /dictionary/);
  refused(play(st, { r: 5, c: 2, dir: 'X', word: 'cat' }), 'BAD_DIRECTION');
  refused(play(st, { r: 'x', c: 2, word: 'cat' }), 'NO_START');
});

test('off the board says how much room there is', () => {
  const st = board();
  const r = refused(play(st, { r: 5, c: 8, word: 'cat' }), 'OFF_BOARD');
  assert.strictEqual(r.needed, 3);
  assert.strictEqual(r.available, 2);
  assert.match(r.hint, /only 2 squares/);
});

test('a letter that is nowhere to be found names the letter and position', () => {
  const st = board();
  st.put(0, 0, 'c', 'red'); st.put(0, 1, 'a', 'red'); // no t anywhere
  const r = refused(play(st, { r: 5, c: 2, word: 'cat' }), 'MISSING_LETTER');
  assert.strictEqual(r.letter, 't');
  assert.strictEqual(r.position, 3);
  assert.match(r.error, /No available letter/);
});

test('each rule gets its own explanation', () => {
  // needs a black letter in place
  let st = board();
  st.put(0, 0, 'c', 'red'); st.put(0, 1, 'a', 'red'); st.put(0, 2, 't', 'red');
  refused(play(st, { r: 5, c: 2, word: 'cat' }), 'NO_BLACK');

  // black letters are in place but nothing of yours can be used
  st = board();
  st.put(5, 2, 'c', 'house'); st.put(5, 3, 'a', 'house'); st.put(0, 0, 't', 'blue');
  refused(play(st, { r: 5, c: 2, word: 'cat' }), 'NO_OWN');

  // everything is already in place, so nothing moves
  st = board();
  st.put(5, 2, 'c', 'red'); st.put(5, 3, 'a', 'house'); st.put(5, 4, 't', 'red');
  refused(play(st, { r: 5, c: 2, word: 'cat' }), 'NO_MOVE');

  // each rule is satisfiable alone, but the same single pyramid is needed twice
  st = board();
  st.put(5, 2, 'a', 'house'); st.put(0, 0, 'l', 'red');
  const r = refused(play(st, { r: 5, c: 2, word: 'all' }), 'CONFLICT');
  assert.match(r.hint, /same pyramid/);
});

test('a legal word still plays, and the hint text never names hidden pieces', () => {
  const st = board();
  st.put(5, 2, 'c', 'house'); st.put(0, 0, 'a', 'red'); st.put(0, 1, 't', 'red');
  assert.ok(play(st, { r: 5, c: 2, word: 'cat' }).ok);
  // a buried piece (not on top) must never be offered as a reason or a source
  const buried = board();
  buried.put(0, 0, 'q', 'red'); buried.put(0, 0, 'x', 'red'); // q is under x
  const res = play(buried, { r: 5, c: 2, word: 'cat' });
  assert.ok(!res.ok);
  assert.ok(!/\bq\b/i.test(res.hint + res.error), 'does not mention the buried letter');
});

test('pass refusals carry a code and a hint too', () => {
  const st = board();
  const res = g.passTurn(st, 'blue');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'NOT_YOUR_TURN');
  assert.ok(res.hint);
});
