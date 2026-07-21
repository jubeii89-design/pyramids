'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../server/game');

const DICT = new Set(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8').split('\n').filter(Boolean)
);

// Deterministic rng
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('setup: pyramid counts and layout', () => {
  const st = g.createGame(['red', 'blue'], seeded(1));
  // 4 colors x 30 player pyramids + 36 house pyramids
  let counts = { red: 0, blue: 0, green: 0, yellow: 0, house: 0 };
  for (const row of st.cells) for (const cell of row) for (const p of cell.stack) counts[p.o]++;
  assert.deepStrictEqual(counts, { red: 30, blue: 30, green: 30, yellow: 30, house: 36 });
  // start stacks are 5 high on 6 spaces per color
  for (const color of g.COLORS) {
    for (const [r, c] of g.startSpaces(color)) {
      assert.strictEqual(st.cells[r][c].stack.length, 5);
      assert.ok(st.cells[r][c].stack.every((p) => p.o === color));
    }
  }
  // each player set is all 26 letters + extra a,e,i,o
  const letters = {};
  for (const row of st.cells) for (const cell of row) for (const p of cell.stack) {
    if (p.o === 'red') letters[p.l] = (letters[p.l] || 0) + 1;
  }
  assert.strictEqual(Object.keys(letters).length, 26);
  assert.strictEqual(letters.a, 2); assert.strictEqual(letters.e, 2);
  assert.strictEqual(letters.z, 1);
  // inner cells all have printed letter + house pyramid
  for (let r = 2; r <= 7; r++) for (let c = 2; c <= 7; c++) {
    assert.ok(st.cells[r][c].printed);
    assert.strictEqual(st.cells[r][c].stack.filter((p) => p.o === 'house').length, 1);
  }
  // runway ring is empty and unprinted
  for (let i = 0; i < 10; i++) {
    for (const [r, c] of [[0, i], [9, i], [i, 0], [i, 9]]) {
      assert.strictEqual(st.cells[r][c].stack.length, 0);
      assert.strictEqual(st.cells[r][c].printed, null);
    }
  }
  assert.strictEqual(st.phase, 'playing');
  assert.ok(st.players.includes(st.players[st.turn]));
});

test('who goes first: lowest exposed tip total', () => {
  const st = g.createGame(['red', 'blue', 'green', 'yellow'], seeded(7));
  const sums = st.players.map((color) => {
    let sum = 0;
    for (const [r, c] of g.startSpaces(color)) {
      const s = st.cells[r][c].stack;
      sum += s[s.length - 1].v;
    }
    return sum;
  });
  const min = Math.min(...sums);
  assert.strictEqual(sums[st.turn], min);
});

test('word rejected: not in dictionary / too short / off turn / off board', () => {
  const st = g.createGame(['red', 'blue'], seeded(2));
  const cur = st.players[st.turn];
  const other = st.players.find((c) => c !== cur);
  assert.match(g.playWord(st, other, { r: 4, c: 2, dir: 'H', word: 'tea' }, DICT).error, /turn/i);
  assert.match(g.playWord(st, cur, { r: 4, c: 2, dir: 'H', word: 'zzqzz' }, DICT).error, /dictionary/i);
  assert.match(g.playWord(st, cur, { r: 4, c: 2, dir: 'H', word: 'at' }, DICT).error, /3 letters/i);
  assert.match(g.playWord(st, cur, { r: 4, c: 8, dir: 'H', word: 'letters' }, DICT).error, /fit/i);
});

test('playWord applies a legal move found by the AI and scores it', () => {
  const st = g.createGame(['red', 'blue'], seeded(3));
  const cur = st.players[st.turn];
  const botWords = [...DICT].filter((w) => w.length >= 3 && w.length <= 5).slice(0, 30000);
  const move = g.findMove(st, cur, botWords, seeded(4));
  assert.ok(move, 'AI should find an opening move');
  const before = st.scores[cur];
  const res = g.playWord(st, cur, move, DICT);
  assert.strictEqual(res.ok, true);
  assert.ok(res.points > 0);
  assert.strictEqual(st.scores[cur], before + res.points);
  assert.strictEqual(st.collected[cur].length, res.collected);
  // turn advanced
  assert.notStrictEqual(st.players[st.turn], cur);
});

test('conservation: no pyramids created or destroyed by moves', () => {
  const st = g.createGame(['red', 'blue', 'green'], seeded(5));
  const total = () => {
    let n = 0;
    for (const row of st.cells) for (const cell of row) n += cell.stack.length;
    for (const c of st.players) n += st.collected[c].length;
    return n;
  };
  const start = total();
  const botWords = [...DICT].filter((w) => w.length >= 3 && w.length <= 5);
  for (let i = 0; i < 6 && st.phase === 'playing'; i++) {
    const cur = st.players[st.turn];
    const mv = g.findMove(st, cur, botWords, seeded(50 + i));
    if (mv) assert.ok(g.playWord(st, cur, mv, DICT).ok);
    else g.passTurn(st, cur);
    assert.strictEqual(total(), start, 'pyramid count must be conserved');
  }
});

test('every played word uses own pyramid + black letter (probe agrees)', () => {
  const st = g.createGame(['red', 'blue'], seeded(6));
  const cur = st.players[st.turn];
  // A word placed entirely on the runway with only stolen letters must fail:
  // runway has no black letters. Any 3-letter word at (0,0)H can only use moved
  // player pyramids there, so hasBlack is false.
  const res = g.playWord(st, cur, { r: 0, c: 0, dir: 'H', word: 'tea' }, DICT);
  assert.strictEqual(res.ok, false);
});

test('pass stalemate ends game with final scoring', () => {
  const st = g.createGame(['red', 'blue'], seeded(8));
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(st.phase, 'playing');
    g.passTurn(st, st.players[st.turn]);
  }
  assert.strictEqual(st.phase, 'over');
  assert.ok(st.finalScores);
  // nobody collected anything; both scores should equal minus their on-board value
  for (const c of st.players) {
    assert.strictEqual(st.finalScores[c], -g.remainingOnBoard(st, c).pts);
  }
  assert.ok(st.winner);
});

test('game ends when a seated color is exhausted', () => {
  const st = g.createGame(['red', 'blue'], seeded(9));
  // Forcibly remove all red pyramids except one, then collect the last via endCheck path:
  // simulate by clearing red from board and calling a pass (endCheck runs on playWord only),
  // so instead verify remainingOnBoard + finish logic directly.
  for (const row of st.cells) for (const cell of row) {
    cell.stack = cell.stack.filter((p) => p.o !== 'red');
  }
  assert.strictEqual(g.remainingOnBoard(st, 'red').n, 0);
  // next successful word triggers endCheck; emulate minimal: blue plays any move
  const botWords = [...DICT].filter((w) => w.length >= 3 && w.length <= 5);
  const cur = st.players[st.turn];
  const mv = g.findMove(st, cur, botWords, seeded(10));
  if (mv) {
    g.playWord(st, cur, mv, DICT);
    assert.strictEqual(st.phase, 'over');
    assert.ok(st.finalScores);
  }
});

test('serialize exposes only public info and correct tops', () => {
  const st = g.createGame(['red', 'blue'], seeded(11));
  const s = g.serialize(st);
  assert.strictEqual(s.size, 10);
  assert.strictEqual(s.cells.length, 10);
  const cell = s.cells[4][4];
  assert.ok(cell.t && cell.t.o === 'house');
  assert.strictEqual(cell.n, 1);
  assert.ok(!JSON.stringify(s).includes('"stack"'));
});

test('moved pyramids come only from pre-turn tops (uncovered rule)', () => {
  // one source cell may contribute at most one pyramid per turn
  const st = g.createGame(['red', 'blue'], seeded(12));
  const cur = st.players[st.turn];
  // Find a start stack of cur, note its top two letters; any legal move the
  // engine produces must never take 2 pyramids from the same cell. We assert
  // via stack depth deltas.
  const depths = st.cells.map((row) => row.map((c) => c.stack.length));
  const botWords = [...DICT].filter((w) => w.length >= 3 && w.length <= 6);
  const mv = g.findMove(st, cur, botWords, seeded(13));
  assert.ok(mv);
  assert.ok(g.playWord(st, cur, mv, DICT).ok);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    const delta = depths[r][c] - st.cells[r][c].stack.length;
    assert.ok(delta <= 1, `cell ${r},${c} lost ${delta} pyramids in one turn`);
  }
});
