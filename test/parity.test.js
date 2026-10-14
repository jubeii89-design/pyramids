'use strict';
// The bot's fast resolver (probeMove) and the real move resolver (planWord)
// must agree on legality for every candidate word, or bots could "see" moves
// players cannot make (and the reverse).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../server/game');

const all = fs.readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const DICT = new Set(all);
const short = all.filter((w) => w.length >= 3 && w.length <= 6);

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('probeMove and planWord agree on legality across random boards and words', () => {
  let compared = 0, legal = 0;
  for (let game = 0; game < 12; game++) {
    const rng = seeded(100 + game);
    const st = g.createGame(['red', 'blue', 'green'].slice(0, 2 + (game % 2)), rng);
    for (let turn = 0; turn < 8 && st.phase === 'playing'; turn++) {
      const color = st.players[st.turn];
      for (let k = 0; k < 150; k++) {
        const word = short[Math.floor(rng() * short.length)];
        const move = { r: Math.floor(rng() * 10), c: Math.floor(rng() * 10), dir: rng() < 0.5 ? 'H' : 'V', word };
        const probe = !!g.probeMove(st, color, move);
        const plan = g.planWord(st, color, move, DICT).ok;
        assert.strictEqual(probe, plan, `${word} at ${move.r},${move.c} ${move.dir}: probeMove=${probe} planWord=${plan}`);
        compared++; if (plan) legal++;
      }
      const mv = g.findMove(st, color, short, rng);
      if (mv) g.playWord(st, color, mv, DICT); else g.passTurn(st, color);
    }
  }
  assert.ok(compared > 1000);
  assert.ok(legal > 0, 'the sample must include legal moves, or the test proves nothing');
});

test('planWord never mutates the game and its steps name only exposed pieces', () => {
  const rng = seeded(7);
  const st = g.createGame(['red', 'blue'], rng);
  const color = st.players[st.turn];
  const mv = g.findMove(st, color, short, rng);
  assert.ok(mv, 'a first move exists');
  const before = JSON.stringify(st);
  const plan = g.planWord(st, color, mv, DICT);
  assert.ok(plan.ok);
  assert.strictEqual(JSON.stringify(st), before, 'preview must not change the state');
  const tops = new Set(st.cells.flat().filter((c) => c.stack.length).map((c) => c.stack[c.stack.length - 1].id));
  for (const step of plan.presentation.steps) if (step.pieceId !== undefined) assert.ok(tops.has(step.pieceId), 'step uses a non-top piece');
  assert.ok(!JSON.stringify(plan).includes('points'), 'preview leaks points');
});
