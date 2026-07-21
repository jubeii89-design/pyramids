'use strict';
// Crossword Pyramids — core rules engine (no I/O, fully testable)

const SIZE = 10;
const COLORS = ['red', 'blue', 'green', 'yellow'];

// Point values engraved on pyramid tips (1-9, per the physical set)
const VALUES = {
  a: 1, e: 1, i: 1, o: 1, u: 1, n: 1, r: 1, s: 1, t: 1,
  l: 2, d: 2,
  b: 3, c: 3, m: 3, h: 3,
  f: 4, g: 4,
  p: 5, y: 5,
  k: 6,
  v: 7, w: 7, j: 7,
  x: 8,
  q: 9, z: 9,
};

// Each player's 30 letters: every letter once, plus an extra A, E, I, O
const PLAYER_LETTERS = 'abcdefghijklmnopqrstuvwxyzaeio'.split('');

// 42 black house pyramid letters (common-letter heavy); 36 are placed each game
const HOUSE_LETTERS = (
  'eeeee' + 'aaaa' + 'iiii' + 'oooo' + 'ssss' + 'tttt' +
  'nnn' + 'rrr' + 'll' + 'uu' + 'dd' + 'cmhgbw'
).split('');

// Printed letters on the 36 inner squares (rows 2-7, cols 2-7)
const PRINTED_INNER = [
  'cotmuf',
  'huliae',
  'erits'.concat('n'),
  'saosrn',
  'guneib',
  'olsime',
];

// Printed letters beneath the six colored start spaces spell "YRAMID"
// (with P/S on the corner squares, completing PYRAMIDS around the ring)
const START_PRINTED = 'yramid'.split('');

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Start spaces for each color (host-side board orientation)
function startSpaces(color) {
  const out = [];
  for (let k = 0; k < 6; k++) {
    if (color === 'red') out.push([1, 2 + k]);
    else if (color === 'yellow') out.push([8, 2 + k]);
    else if (color === 'green') out.push([2 + k, 1]);
    else if (color === 'blue') out.push([2 + k, 8]);
  }
  return out;
}

let nextId = 1;
function makePyramid(letter, owner) {
  return { id: nextId++, l: letter, v: VALUES[letter], o: owner };
}

function createGame(playerColors, rng = Math.random) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    cells.push([]);
    for (let c = 0; c < SIZE; c++) cells[r].push({ printed: null, stack: [] });
  }
  // Printed inner letters
  for (let r = 2; r <= 7; r++)
    for (let c = 2; c <= 7; c++) cells[r][c].printed = PRINTED_INNER[r - 2][c - 2];
  // Corner printed letters (S/P of "PYRAMIDS")
  cells[1][1].printed = 's';
  cells[1][8].printed = 'p';
  cells[8][1].printed = 'p';
  cells[8][8].printed = 's';

  // All four colors are set up even with fewer players (per the rules)
  for (const color of COLORS) {
    const spaces = startSpaces(color);
    const letters = shuffle(PLAYER_LETTERS, rng);
    spaces.forEach(([r, c], i) => {
      cells[r][c].printed = START_PRINTED[i];
      for (let k = 0; k < 5; k++) {
        cells[r][c].stack.push(makePyramid(letters[i * 5 + k], color));
      }
    });
  }

  // 36 of 42 house pyramids on the inner squares
  const house = shuffle(HOUSE_LETTERS, rng).slice(0, 36);
  let hi = 0;
  for (let r = 2; r <= 7; r++)
    for (let c = 2; c <= 7; c++) cells[r][c].stack.push(makePyramid(house[hi++], 'house'));

  const state = {
    cells,
    players: playerColors.slice(), // colors of seated players, turn order
    turn: 0,                       // index into players
    phase: 'playing',
    collected: {},                 // color -> [pyramid,...]
    scores: {},                    // color -> running collected points
    passes: 0,                     // consecutive passes
    log: [],                       // {color, word, points} history
    winner: null,
    finalScores: null,
  };
  for (const c of playerColors) {
    state.collected[c] = [];
    state.scores[c] = 0;
  }

  // Who goes first: lowest sum of exposed tip values on your six start stacks
  let best = null;
  playerColors.forEach((color, idx) => {
    let sum = 0;
    for (const [r, c] of startSpaces(color)) {
      const s = cells[r][c].stack;
      if (s.length) sum += s[s.length - 1].v;
    }
    if (best === null || sum < best.sum) best = { idx, sum };
  });
  state.turn = best ? best.idx : 0;
  return state;
}

function exposed(cell) {
  if (cell.stack.length) {
    const top = cell.stack[cell.stack.length - 1];
    return { letter: top.l, kind: 'pyramid', owner: top.o, value: top.v };
  }
  if (cell.printed) return { letter: cell.printed, kind: 'printed' };
  return null;
}

function pathCells(r, c, dir, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const rr = dir === 'V' ? r + i : r;
    const cc = dir === 'H' ? c + i : c;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return null;
    out.push([rr, cc]);
  }
  return out;
}

/**
 * Attempt to play `word` starting at (r,c) going dir ('H' or 'V').
 * The engine resolves letter sources automatically:
 *  - a path cell whose exposed letter matches is used in place
 *  - otherwise an exposed player pyramid elsewhere is moved onto that cell
 * Returns {ok:true, result} and mutates state, or {ok:false, error}.
 */
function playWord(state, color, move, dict) {
  if (state.phase !== 'playing') return { ok: false, error: 'Game is not in progress.' };
  if (state.players[state.turn] !== color) return { ok: false, error: 'Not your turn.' };

  const word = String(move.word || '').toLowerCase().trim();
  if (!/^[a-z]{3,}$/.test(word)) return { ok: false, error: 'Words must be at least 3 letters (A-Z only).' };
  if (!dict.has(word)) return { ok: false, error: `"${word.toUpperCase()}" is not in the dictionary.` };
  if (move.dir !== 'H' && move.dir !== 'V') return { ok: false, error: 'Direction must be H or V.' };

  const path = pathCells(move.r | 0, move.c | 0, move.dir, word.length);
  if (!path) return { ok: false, error: 'Word does not fit on the board there.' };

  const cells = state.cells;
  const onPath = new Set(path.map(([r, c]) => r * SIZE + c));

  // Candidate sources for each letter position
  const positions = [];
  for (let i = 0; i < word.length; i++) {
    const [r, c] = path[i];
    const need = word[i];
    const ex = exposed(cells[r][c]);
    const opts = [];
    if (ex && ex.letter === need) opts.push({ type: 'inplace', ex });
    // movable exposed player pyramids elsewhere on the board
    for (let rr = 0; rr < SIZE; rr++) {
      for (let cc = 0; cc < SIZE; cc++) {
        if (onPath.has(rr * SIZE + cc)) continue;
        const s = cells[rr][cc].stack;
        if (!s.length) continue;
        const top = s[s.length - 1];
        if (top.o !== 'house' && top.l === need) opts.push({ type: 'move', from: rr * SIZE + cc, owner: top.o });
      }
    }
    if (!opts.length) return { ok: false, error: `No available letter "${need.toUpperCase()}" for position ${i + 1}.` };
    positions.push(opts);
  }

  // Backtracking: pick one source per position; a source cell may only give
  // up its (pre-turn) top pyramid once — this also enforces the rule that a
  // pyramid uncovered this turn cannot be used in the same turn.
  const used = new Set();
  const choice = new Array(word.length).fill(null);
  let solution = null;

  function feasible(assign) {
    let hasOwn = false, hasBlack = false, moved = 0;
    for (const ch of assign) {
      if (ch.type === 'inplace') {
        if (ch.ex.kind === 'printed') hasBlack = true;
        else if (ch.ex.owner === 'house') hasBlack = true;
        else if (ch.ex.owner === color) hasOwn = true;
      } else {
        moved++;
        if (ch.owner === color) hasOwn = true;
      }
    }
    return hasOwn && hasBlack && moved >= 1;
  }

  function search(i) {
    if (solution) return;
    if (i === word.length) {
      if (feasible(choice)) solution = choice.slice();
      return;
    }
    for (const opt of positions[i]) {
      if (opt.type === 'move') {
        if (used.has(opt.from)) continue;
        used.add(opt.from);
        choice[i] = opt;
        search(i + 1);
        used.delete(opt.from);
      } else {
        choice[i] = opt;
        search(i + 1);
      }
      if (solution) return;
    }
  }
  search(0);

  if (!solution) {
    return {
      ok: false,
      error: 'Cannot form that word legally: it must use at least one of your own pyramids, one black letter (house pyramid or printed letter), and move at least one pyramid.',
    };
  }

  // Apply the move: move pyramids onto the path, then collect everything used
  const collectedNow = [];
  for (let i = 0; i < word.length; i++) {
    const [r, c] = path[i];
    const ch = solution[i];
    if (ch.type === 'move') {
      const fr = Math.floor(ch.from / SIZE), fc = ch.from % SIZE;
      const pyr = cells[fr][fc].stack.pop();
      collectedNow.push(pyr); // it lands on the path and is immediately part of the word
    } else if (ch.ex.kind === 'pyramid') {
      collectedNow.push(cells[r][c].stack.pop());
    }
    // printed letters stay on the board and score nothing
  }

  let points = 0;
  for (const p of collectedNow) points += p.v;
  state.collected[color].push(...collectedNow);
  state.scores[color] += points;
  state.passes = 0;
  state.log.push({ color, word, points, pyramids: collectedNow.length });
  if (state.log.length > 60) state.log.shift();

  endCheck(state);
  if (state.phase === 'playing') advanceTurn(state);
  return { ok: true, word, points, collected: collectedNow.length };
}

function passTurn(state, color) {
  if (state.phase !== 'playing') return { ok: false, error: 'Game is not in progress.' };
  if (state.players[state.turn] !== color) return { ok: false, error: 'Not your turn.' };
  state.passes++;
  state.log.push({ color, word: null, points: 0, pass: true });
  if (state.log.length > 60) state.log.shift();
  // Stalemate: two full rounds of passes ends the game
  if (state.passes >= state.players.length * 2) {
    finish(state);
    return { ok: true, ended: true };
  }
  advanceTurn(state);
  return { ok: true };
}

function advanceTurn(state) {
  state.turn = (state.turn + 1) % state.players.length; // clockwise
}

function remainingOnBoard(state, color) {
  let n = 0, pts = 0;
  for (const row of state.cells)
    for (const cell of row)
      for (const p of cell.stack)
        if (p.o === color) { n++; pts += p.v; }
  return { n, pts };
}

function endCheck(state) {
  // Game ends when all of any seated player's colored pyramids are gone
  for (const color of state.players) {
    if (remainingOnBoard(state, color).n === 0) { finish(state); return; }
  }
}

function finish(state) {
  state.phase = 'over';
  const finals = {};
  for (const color of state.players) {
    finals[color] = state.scores[color] - remainingOnBoard(state, color).pts;
  }
  state.finalScores = finals;
  let best = null;
  for (const color of state.players) {
    if (best === null || finals[color] > finals[best]) best = color;
  }
  state.winner = best;
}

// Public serialization sent to clients
function serialize(state) {
  return {
    size: SIZE,
    phase: state.phase,
    players: state.players,
    turn: state.turn,
    current: state.players[state.turn],
    scores: state.scores,
    finalScores: state.finalScores,
    winner: state.winner,
    log: state.log.slice(-12),
    cells: state.cells.map((row) =>
      row.map((cell) => ({
        p: cell.printed,
        n: cell.stack.length,
        t: cell.stack.length
          ? { l: cell.stack[cell.stack.length - 1].l, v: cell.stack[cell.stack.length - 1].v, o: cell.stack[cell.stack.length - 1].o }
          : null,
      }))
    ),
  };
}

// ---- AI player -------------------------------------------------------------

// Find a legal move for `color`. Tries dictionary words (shuffled, feasibility
// filtered) across all placements; returns the best of the first few found.
function findMove(state, color, botWords, rng = Math.random, maxFound = 4) {
  // Multiset of every available letter (exposed pyramids + printed)
  const avail = {};
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const ex = exposed(state.cells[r][c]);
      if (ex) avail[ex.letter] = (avail[ex.letter] || 0) + 1;
    }
  const fits = (word) => {
    const need = {};
    for (const ch of word) {
      need[ch] = (need[ch] || 0) + 1;
      if (need[ch] > (avail[ch] || 0)) return false;
    }
    return true;
  };

  // Pre-index movable exposed player pyramids by letter (big speedup)
  const sourcesByLetter = {};
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const s = state.cells[r][c].stack;
      if (!s.length) continue;
      const top = s[s.length - 1];
      if (top.o === 'house' || top.o === 'hidden') continue;
      (sourcesByLetter[top.l] = sourcesByLetter[top.l] || []).push({ from: r * SIZE + c, owner: top.o, value: top.v });
    }

  const words = shuffle(botWords, rng);
  const found = [];
  const deadline = Date.now() + 3000;
  for (const word of words) {
    if (Date.now() > deadline && found.length) break;
    if (found.length >= maxFound) break;
    if (!fits(word)) continue;
    for (let dir of ['H', 'V']) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (dir === 'H' && c + word.length > SIZE) continue;
          if (dir === 'V' && r + word.length > SIZE) continue;
          const probe = probeMove(state, color, { r, c, dir, word }, sourcesByLetter);
          if (probe) {
            found.push({ r, c, dir, word, score: probe.points + probe.ownUsed * 3 });
            if (found.length >= maxFound) break;
          }
        }
        if (found.length >= maxFound) break;
      }
      if (found.length >= maxFound) break;
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  return found[0];
}

// Dry-run version of playWord's resolver (no mutation, no dictionary check).
// Pass a prebuilt sourcesByLetter index for speed, or omit to scan.
function probeMove(state, color, move, sourcesByLetter) {
  const word = move.word;
  const path = pathCells(move.r, move.c, move.dir, word.length);
  if (!path) return null;
  const cells = state.cells;
  const onPath = new Set(path.map(([r, c]) => r * SIZE + c));
  const positions = [];
  for (let i = 0; i < word.length; i++) {
    const [r, c] = path[i];
    const need = word[i];
    const ex = exposed(cells[r][c]);
    const opts = [];
    if (ex && ex.letter === need) opts.push({ type: 'inplace', ex });
    if (sourcesByLetter) {
      for (const src of sourcesByLetter[need] || []) {
        if (!onPath.has(src.from)) opts.push({ type: 'move', ...src });
      }
    } else {
      for (let rr = 0; rr < SIZE; rr++)
        for (let cc = 0; cc < SIZE; cc++) {
          if (onPath.has(rr * SIZE + cc)) continue;
          const s = cells[rr][cc].stack;
          if (!s.length) continue;
          const top = s[s.length - 1];
          if (top.o !== 'house' && top.l === need) opts.push({ type: 'move', from: rr * SIZE + cc, owner: top.o, value: top.v });
        }
    }
    if (!opts.length) return null;
    positions.push(opts);
  }
  const used = new Set();
  const choice = new Array(word.length).fill(null);
  let result = null;
  function search(i) {
    if (result) return;
    if (i === word.length) {
      let hasOwn = false, hasBlack = false, moved = 0, points = 0, ownUsed = 0;
      for (const ch of choice) {
        if (ch.type === 'inplace') {
          if (ch.ex.kind === 'printed') hasBlack = true;
          else if (ch.ex.owner === 'house') { hasBlack = true; points += ch.ex.value; }
          else {
            points += ch.ex.value;
            if (ch.ex.owner === color) { hasOwn = true; ownUsed++; }
          }
        } else {
          moved++;
          points += ch.value;
          if (ch.owner === color) { hasOwn = true; ownUsed++; }
        }
      }
      if (hasOwn && hasBlack && moved >= 1) result = { points, ownUsed };
      return;
    }
    for (const opt of positions[i]) {
      if (opt.type === 'move') {
        if (used.has(opt.from)) continue;
        used.add(opt.from);
        choice[i] = opt;
        search(i + 1);
        used.delete(opt.from);
      } else {
        choice[i] = opt;
        search(i + 1);
      }
      if (result) return;
    }
  }
  search(0);
  return result;
}

module.exports = {
  SIZE, COLORS, VALUES, PLAYER_LETTERS, HOUSE_LETTERS,
  createGame, playWord, passTurn, serialize, exposed, findMove, probeMove,
  remainingOnBoard, startSpaces,
};
