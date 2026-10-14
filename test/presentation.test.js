'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/game');

const DICT = new Set(['cart', 'care', 'carr', 'car']);
const MOVE = { r: 4, c: 2, dir: 'H', word: 'cart' };
const clone = (value) => JSON.parse(JSON.stringify(value));

// A fixed board exercises every presentation kind without relying on the
// time-budgeted bot search. Buried E/Z pieces must never enter a preview.
function fixture() {
  const state = g.createGame(['red', 'blue'], () => 0.5);
  for (const row of state.cells) for (const cell of row) {
    cell.printed = null;
    cell.stack = [];
  }
  state.turn = 0;
  let id = 1000;
  const piece = (l, o) => ({ id: id++, l, v: g.VALUES[l], o });
  state.cells[4][2] = { printed: 'q', stack: [piece('c', 'house')] };
  state.cells[4][3].printed = 'a';
  state.cells[1][2].stack = [
    piece('z', 'red'), piece('z', 'red'), piece('z', 'red'),
    piece('e', 'red'), piece('r', 'red'),
  ];
  state.cells[2][8].stack = [
    piece('z', 'blue'), piece('z', 'blue'), piece('z', 'blue'),
    piece('e', 'blue'), piece('t', 'blue'),
  ];
  // The incoming R is collected; this mismatching destination top stays put.
  state.cells[4][4] = { printed: 'u', stack: [piece('z', 'house')] };
  return state;
}

function exposedPieces(state) {
  const pieces = new Map();
  state.cells.forEach((row, r) => row.forEach((cell, c) => {
    const top = cell.stack[cell.stack.length - 1];
    if (top) pieces.set(top.id, { ...top, from: [r, c] });
  }));
  return pieces;
}

test('word plan is a repeatable, score-free dry run and commit has identical presentation', () => {
  const state = fixture();
  const before = clone(state);
  const plan = g.planWord(state, 'red', MOVE, DICT);
  assert.equal(plan.ok, true);
  assert.equal(plan.word, 'cart');
  assert.equal(Object.hasOwn(plan, 'points'), false, 'preview must not expose a word score');
  assert.deepEqual(state, before, 'planning cannot change stacks, log, turn, or scores');
  assert.deepEqual(g.planWord(state, 'red', MOVE, DICT), plan, 'repeated preview resolves the same sources');
  assert.deepEqual(state, before);

  const expected = clone(before);
  const captured = [expected.cells[4][2].stack.pop(), expected.cells[1][2].stack.pop(), expected.cells[2][8].stack.pop()];
  expected.collected.red.push(...captured);
  expected.scores.red = 5;
  expected.passes = 0;
  expected.log.push({ color: 'red', word: 'cart', points: 5, pyramids: 3 });
  expected.turn = 1;

  const result = g.playWord(state, 'red', MOVE, DICT);
  assert.equal(result.ok, true);
  assert.equal(result.points, 5);
  assert.equal(result.collected, 3);
  assert.deepEqual(result.presentation, plan.presentation);
  assert.deepEqual(state, expected, 'presentation metadata must not change the existing move outcome');
});

test('motion steps identify only pre-turn visible pieces and exact capture destinations', () => {
  const state = fixture();
  const visible = exposedPieces(state);
  const { presentation } = g.planWord(state, 'red', MOVE, DICT);
  const steps = presentation.steps;
  assert.deepEqual(steps.map((step) => step.kind), ['inplace', 'printed', 'move', 'move']);
  assert.deepEqual(steps.map((step) => step.letter), ['c', 'a', 'r', 't']);
  assert.deepEqual(steps.map((step) => step.to), [[4, 2], [4, 3], [4, 4], [4, 5]]);
  assert.deepEqual(steps.map((step) => step.from), [[4, 2], [4, 3], [1, 2], [2, 8]]);

  const ids = [];
  for (const step of steps) {
    if (step.kind === 'printed') {
      assert.ok(step.pieceId == null, 'printed letters are not movable pieces');
      assert.ok(step.value == null || step.value === 0, 'printed letters have no tip value');
      continue;
    }
    const top = visible.get(step.pieceId);
    assert.ok(top, `piece ${step.pieceId} must be exposed before the turn`);
    assert.deepEqual(step.from, top.from);
    assert.equal(step.letter, top.l);
    assert.equal(step.value, top.v);
    assert.equal(step.owner, top.o);
    ids.push(step.pieceId);
  }
  assert.equal(new Set(ids).size, ids.length, 'one source top is never reused');
  assert.deepEqual(presentation.captureIds, ids);
  const result = g.playWord(state, 'red', MOVE, DICT);
  assert.deepEqual(result.presentation.captureIds, state.collected.red.map((piece) => piece.id));
  assert.equal(JSON.stringify(presentation).includes('"stack"'), false);
  assert.equal(JSON.stringify(presentation).includes('"points"'), false);
});

test('commit decrements only consumed sources and preserves covered destination pieces', () => {
  const state = fixture();
  const before = clone(state);
  assert.equal(g.playWord(state, 'red', MOVE, DICT).ok, true);
  const changed = new Set(['4,2', '1,2', '2,8']);
  for (let r = 0; r < g.SIZE; r++) for (let c = 0; c < g.SIZE; c++) {
    const oldCell = before.cells[r][c];
    const newCell = state.cells[r][c];
    const expectedDrop = changed.has(`${r},${c}`) ? 1 : 0;
    assert.equal(oldCell.stack.length - newCell.stack.length, expectedDrop, `stack ${r},${c}`);
    assert.deepEqual(newCell.stack, expectedDrop ? oldCell.stack.slice(0, -1) : oldCell.stack);
    assert.equal(newCell.printed, oldCell.printed);
  }
  const publicState = g.serialize(state);
  assert.equal(publicState.cells[1][2].n, 4);
  assert.equal(publicState.cells[2][8].n, 4);
  assert.equal(publicState.cells[4][2].n, 0);
  assert.equal(publicState.cells[4][3].p, 'a');
  assert.equal(publicState.cells[4][4].t.id, before.cells[4][4].stack[0].id);
});

test('serialization includes exposed IDs without revealing buried identities or scores', () => {
  const state = fixture();
  const publicState = g.serialize(state);
  const actual = [];
  for (let r = 0; r < g.SIZE; r++) for (let c = 0; c < g.SIZE; c++) {
    const publicCell = publicState.cells[r][c];
    const stack = state.cells[r][c].stack;
    assert.equal(Object.hasOwn(publicCell, 'stack'), false);
    if (!stack.length) {
      assert.equal(publicCell.t, null);
      continue;
    }
    const top = stack[stack.length - 1];
    assert.deepEqual(publicCell.t, { id: top.id, l: top.l, v: top.v, o: top.o });
    actual.push(publicCell.t.id);
  }
  assert.deepEqual(actual, [...exposedPieces(state).keys()]);
  assert.equal(publicState.scores, null);
  assert.equal(publicState.finalScores, null);
});

test('invalid plans and commits reject without mutating state or leaking a presentation', () => {
  const cases = [
    { label: 'wrong player', color: 'blue', move: MOVE },
    { label: 'not a dictionary word', move: { ...MOVE, word: 'caz' } },
    { label: 'too short', move: { ...MOVE, word: 'ca' } },
    { label: 'invalid direction', move: { ...MOVE, dir: 'Q' } },
    { label: 'outside board', move: { ...MOVE, c: 9 } },
    { label: 'buried letter is unavailable', move: { ...MOVE, word: 'care' } },
    { label: 'one exposed source cannot be used twice', move: { ...MOVE, word: 'carr' } },
    { label: 'finished game', move: MOVE, phase: 'over' },
  ];
  for (const scenario of cases) {
    const state = fixture();
    if (scenario.phase) state.phase = scenario.phase;
    const before = clone(state);
    const plan = g.planWord(state, scenario.color || 'red', scenario.move, DICT);
    assert.equal(plan.ok, false, scenario.label);
    assert.equal(plan.presentation, undefined, scenario.label);
    assert.deepEqual(state, before, `${scenario.label}: plan mutated state`);
    const result = g.playWord(state, scenario.color || 'red', scenario.move, DICT);
    assert.equal(result.ok, false, scenario.label);
    assert.equal(result.error, plan.error, scenario.label);
    assert.deepEqual(state, before, `${scenario.label}: commit mutated state`);
  }
});

test('a preview cannot commit twice after its player turn has advanced', () => {
  const state = fixture();
  const plan = g.planWord(state, 'red', MOVE, DICT);
  assert.equal(plan.ok, true);
  assert.equal(g.playWord(state, 'red', MOVE, DICT).ok, true);
  const after = clone(state);
  assert.equal(g.planWord(state, 'red', MOVE, DICT).ok, false);
  assert.equal(g.playWord(state, 'red', MOVE, DICT).ok, false);
  assert.deepEqual(state, after, 'duplicate submission must not capture twice');
});
