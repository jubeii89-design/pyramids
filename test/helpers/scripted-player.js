'use strict';
// A scripted stand-in for a human player, for tests only. It connects over a
// real WebSocket, joins a room and, when it is its turn, plays the best legal
// word the engine can find (or passes). The server itself never plays for
// anyone - this is just a test client.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const game = require('../../server/game');

const WORDS = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'words.txt'), 'utf8')
  .split(/\r?\n/).filter((w) => w.length >= 3 && w.length <= 6);

// The public snapshot exposes only stack tops; that is all move search needs.
function publicToEngine(st) {
  return {
    cells: st.cells.map((row) => row.map((c) => ({
      printed: c.p,
      stack: c.t ? [...Array(c.n - 1).fill({ l: '?', v: 0, o: 'hidden' }), { id: c.t.id, l: c.t.l, v: c.t.v, o: c.t.o }] : [],
    }))),
    players: st.players, turn: st.turn, phase: st.phase,
  };
}

// opts: { play: true } auto-plays; { play: false } only joins and sits there;
// { hold: true } joins and waits to be release()d before it makes its first move;
// { delayMs: n } waits n ms before each move (so a test can freeze the game mid-way).
async function scriptedPlayer(base, code, name, opts = {}) {
  const play = opts.play !== false;
  let hold = !!opts.hold, latest = null;
  const delayMs = opts.delayMs || 0;
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
  ws.on('error', () => {});
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  let color = null, token = null, lastActed = null;
  const rejected = new Set();
  const joined = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('scripted player did not join')), 8000);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'joined') { color = m.color; token = m.token; clearTimeout(to); res(); }
      if (m.type === 'error' && !color) { clearTimeout(to); rej(new Error(m.error)); }
      if (m.type === 'state') latest = m.state;
      if (m.type === 'state' && play && color) act(m.state);
      // A refused move must not stall the game: pass instead (once per position).
      if (m.type === 'reject' && play && color && lastActed && !rejected.has(lastActed)) {
        rejected.add(lastActed);
        ws.send(JSON.stringify({ type: 'pass' }));
      }
    });
  });
  function act(st) {
    if (hold || st.phase !== 'playing' || st.current !== color) return;
    const key = `${st.gameId}:${st.revision}`;
    if (key === lastActed) return;
    lastActed = key;
    if (delayMs) {
      setTimeout(() => {
        if (!latest || `${latest.gameId}:${latest.revision}` !== key) return;
        if (hold) lastActed = null; // paused while waiting: act again on release
        else decide(st);
      }, delayMs);
      return;
    }
    decide(st);
  }
  function decide(st) {
    const move = game.findMove(publicToEngine(st), color, WORDS);
    const base = { gameId: st.gameId, revision: st.revision };
    if (move) ws.send(JSON.stringify({ type: 'play', r: move.r, c: move.c, dir: move.dir, word: move.word, ...base }));
    else ws.send(JSON.stringify({ type: 'pass' }));
  }
  ws.send(JSON.stringify({ type: 'join', code, name }));
  await joined;
  return {
    ws, get color() { return color; }, get token() { return token; }, close: () => ws.close(),
    release() { hold = false; if (latest && play && color) act(latest); },
    pause() { hold = true; },
  };
}

module.exports = { scriptedPlayer, publicToEngine, WORDS };
