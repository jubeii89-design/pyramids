'use strict';
// Manual choice of source pieces: hints narrow the engine's candidates, never widen them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../server/game');
const { message } = require('../server/validate');

const all = fs.readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const DICT = new Set(all);
const short = all.filter((w) => w.length >= 3 && w.length <= 6);
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const topOf = (st, [r, c]) => { const s = st.cells[r][c].stack; return s.length ? s[s.length - 1] : null; };

// Find a state and previewed move where some letter has more than one candidate piece.
function scenario() {
  for (let seed = 1; seed < 60; seed++) {
    const rng = seeded(seed);
    const st = g.createGame(['red', 'blue'], rng);
    for (let turn = 0; turn < 4; turn++) {
      const color = st.players[st.turn];
      for (let k = 0; k < 400; k++) {
        const word = short[Math.floor(rng() * short.length)];
        const move = { r: Math.floor(rng() * 10), c: Math.floor(rng() * 10), dir: rng() < 0.5 ? 'H' : 'V', word };
        const plan = g.planWord(st, color, move, DICT);
        if (!plan.ok) continue;
        const idx = plan.choices.findIndex((ch) => ch.options.length > 1 && ch.options.some((o, j) => j > 0 && o.kind === 'move'));
        if (idx >= 0) return { st, color, move, plan, idx };
      }
      const mv = g.findMove(st, color, short, rng);
      if (mv) g.playWord(st, color, mv, DICT); else g.passTurn(st, color);
    }
  }
  throw new Error('no scenario with a duplicate letter found');
}

test('sources of all null (or absent) give exactly the automatic result', () => {
  const { st, color, move, plan } = scenario();
  const auto = g.planWord(st, color, { ...move, sources: move.word.split('').map(() => null) }, DICT);
  assert.deepStrictEqual(auto.presentation, plan.presentation);
  assert.deepStrictEqual(auto.choices, plan.choices);
});

test('choices list only exposed tops that match the letter, engine pick first', () => {
  const { st, plan, move } = scenario();
  plan.choices.forEach((ch, i) => {
    const need = move.word[i];
    assert.ok(ch.options.length >= 1 && ch.options.length <= 30);
    ch.options.forEach((o) => {
      const top = topOf(st, o.from);
      if (o.kind === 'printed') assert.strictEqual(st.cells[o.from[0]][o.from[1]].printed, need);
      else { assert.ok(top, 'option must be an exposed pyramid'); assert.strictEqual(top.l, need); }
    });
    // the first option is the piece the automatic presentation uses
    const step = plan.presentation.steps[i];
    assert.deepStrictEqual(ch.options[0].from, step.from);
  });
});

test('a hint selects exactly that piece and the commit uses it', () => {
  const { st, color, move, plan, idx } = scenario();
  const alt = plan.choices[idx].options.find((o, j) => j > 0 && o.kind === 'move');
  const sources = move.word.split('').map(() => null);
  sources[idx] = { r: alt.from[0], c: alt.from[1] };
  const before = JSON.stringify(st);
  const planned = g.planWord(st, color, { ...move, sources }, DICT);
  assert.strictEqual(JSON.stringify(st), before, 'preview must not change the game');
  if (!planned.ok) { assert.match(planned.error, /picked|rules|legally|supply/i); return; } // an illegal combination is refused, never forced
  assert.deepStrictEqual(planned.presentation.steps[idx].from, alt.from);
  const pieceId = topOf(st, alt.from).id;
  const done = g.playWord(st, color, { ...move, sources }, DICT);
  assert.ok(done.ok);
  assert.ok(done.presentation.captureIds.includes(pieceId), 'the chosen piece is the one captured');
  assert.deepStrictEqual(done.presentation, planned.presentation, 'preview and commit agree');
});

test('illegal hints are refused and change nothing', () => {
  const { st, color, move, plan } = scenario();
  const before = JSON.stringify(st);
  const n = move.word.length;
  const bad = [
    { r: 0, c: 0 },                                           // a runway square: nothing there to supply the letter
    { r: -1, c: 3 }, { r: 3, c: 99 }, { r: 'x', c: 1 },        // off board / not integers
  ];
  for (const b of bad) {
    const sources = move.word.split('').map(() => null);
    sources[0] = b;
    const res = g.planWord(st, color, { ...move, sources }, DICT);
    assert.ok(!res.ok, `hint ${JSON.stringify(b)} must be refused`);
  }
  assert.ok(!g.planWord(st, color, { ...move, sources: [null] }, DICT).ok, 'wrong number of hints');
  assert.ok(!g.playWord(st, color, { ...move, sources: [null] }, DICT).ok);
  // a house pyramid can never be moved, even if named
  const house = st.cells.flat().map((cell, i) => ({ cell, i })).find((x) => x.cell.stack.length && x.cell.stack[x.cell.stack.length - 1].o === 'house');
  if (house) {
    const sources = move.word.split('').map(() => null);
    const hr = Math.floor(house.i / 10), hc = house.i % 10;
    const onPath = plan.choices.some((ch) => ch.to[0] === hr && ch.to[1] === hc);
    if (!onPath) {
      sources[0] = { r: hr, c: hc };
      assert.ok(!g.planWord(st, color, { ...move, sources }, DICT).ok, 'house pyramids cannot be moved');
    }
  }
  assert.strictEqual(JSON.stringify(st), before, 'refused hints leave the game untouched');
});

test('another player cannot be made to use pieces by hinting at them', () => {
  const { st, color, move, plan } = scenario();
  const other = st.players.find((c) => c !== color);
  const sq = st.cells.flat().map((cell, i) => ({ cell, i })).find((x) => x.cell.stack.length && x.cell.stack[x.cell.stack.length - 1].o === other
    && !plan.choices.some((ch) => ch.to[0] * 10 + ch.to[1] === x.i));
  if (!sq) return;
  const sources = move.word.split('').map(() => null);
  const pos = move.word.split('').findIndex((ch) => ch === sq.cell.stack[sq.cell.stack.length - 1].l);
  if (pos < 0) return;
  sources[pos] = { r: Math.floor(sq.i / 10), c: sq.i % 10 };
  const res = g.planWord(st, color, { ...move, sources }, DICT);
  if (res.ok) assert.ok(res.presentation.steps.every((s) => s.owner !== undefined), 'any accepted move is a normal legal move');
});

test('validator: sources must be one square or null per letter', () => {
  const ok = { type: 'preview', r: 1, c: 2, dir: 'H', word: 'cat', sources: [null, { r: 3, c: 4 }, null] };
  assert.deepStrictEqual(message(ok).msg.sources, [null, { r: 3, c: 4 }, null]);
  for (const bad of [
    { ...ok, sources: [null] }, { ...ok, sources: 'x' }, { ...ok, sources: [null, { r: 10, c: 0 }, null] },
    { ...ok, sources: [null, { r: 1.5, c: 0 }, null] }, { ...ok, sources: [null, 7, null] },
  ]) assert.ok(message(bad).error, JSON.stringify(bad.sources));
  assert.strictEqual(message({ ...ok, sources: undefined }).msg.sources, undefined);
});
