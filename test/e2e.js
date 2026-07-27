'use strict';
// End-to-end AI test harness:
//  - spawns the real server
//  - hosts rooms over WebSocket, verifies room codes and decodes the QR code
//  - joins AI players from separate socket connections (like phones)
//  - plays N full games to completion, checking invariants along the way
//
// Usage: node test/e2e.js [numGames]

// Usage against a live deployment (no local server spawned):
//   REMOTE_URL=https://crossword-pyramids.onrender.com node test/e2e.js 5

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const game = require('../server/game');

const REMOTE_URL = process.env.REMOTE_URL ? process.env.REMOTE_URL.replace(/\/$/, '') : null;
const PORT = 3123;
const BASE = REMOTE_URL || `http://localhost:${PORT}`;
const WS_BASE = BASE.replace(/^http/, 'ws');
const NUM_GAMES = parseInt(process.argv[2] || '5', 10);

const words = fs.readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8').split('\n').filter(Boolean);
const BOT_WORDS = words.filter((w) => w.length >= 3 && w.length <= 6);

const results = [];
let failures = 0;
function check(cond, label) {
  if (cond) return true;
  failures++;
  console.error(`  ✗ CHECK FAILED: ${label}`);
  return false;
}

function httpGet(url) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function wsClient() {
  const ws = new WebSocket(`${WS_BASE}/ws`);
  const queue = [];
  const waiters = [];
  const stats = { bytes: 0, messages: 0, maxMsg: 0 };
  ws.on('message', (raw) => {
    stats.bytes += raw.length;
    stats.messages++;
    if (raw.length > stats.maxMsg) stats.maxMsg = raw.length;
    const msg = JSON.parse(raw);
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  return {
    ws,
    stats,
    send: (m) => ws.send(JSON.stringify(m)),
    next: (timeout = 15000) =>
      new Promise((resolve, reject) => {
        if (queue.length) return resolve(queue.shift());
        const t = setTimeout(() => reject(new Error('ws message timeout')), timeout);
        waiters.push((m) => { clearTimeout(t); resolve(m); });
      }),
    nextOf: async function nextOf(type, timeout = 20000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timeout waiting for ${type}`);
        const m = await this.next(remaining);
        if (m.type === type) return m;
      }
    },
    open: () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }),
    close: () => ws.close(),
  };
}

function decodeQR(dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code ? code.data : null;
}

async function playGame(gameNo, numPlayers) {
  console.log(`\n=== Game ${gameNo}: ${numPlayers} AI players ===`);
  const host = wsClient();
  await host.open();
  host.send({ type: 'host_create', origin: BASE });
  const hosted = await host.nextOf('hosted');

  // Room code + QR verification
  check(/^[A-HJ-NP-Z]{4}$/.test(hosted.code), `room code format (${hosted.code})`);
  check(hosted.joinUrl === `${BASE}/play.html?room=${hosted.code}`, 'join URL matches room');
  const qrText = decodeQR(hosted.qr);
  check(qrText === hosted.joinUrl, `QR decodes to join URL (got: ${qrText})`);
  console.log(`  room ${hosted.code} — QR verified → ${qrText}`);

  // Join AI players from independent connections
  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    const p = wsClient();
    await p.open();
    p.send({ type: 'join', code: hosted.code, name: `Bot${i + 1}` });
    const joined = await p.nextOf('joined');
    check(game.COLORS.includes(joined.color), 'player got a color');
    players.push({ client: p, color: joined.color, name: `Bot${i + 1}` });
  }
  check(new Set(players.map((p) => p.color)).size === numPlayers, 'unique colors assigned');

  // A 5th player must be rejected when full
  if (numPlayers === 4) {
    const extra = wsClient();
    await extra.open();
    extra.send({ type: 'join', code: hosted.code, name: 'TooMany' });
    const err = await extra.nextOf('error');
    check(/full/i.test(err.error), 'fifth player rejected');
    extra.close();
  }

  // Bad room code rejected
  const stranger = wsClient();
  await stranger.open();
  stranger.send({ type: 'join', code: 'ZZZZ', name: 'Lost' });
  const nf = await stranger.nextOf('error');
  check(/not found/i.test(nf.error), 'bad room code rejected');
  stranger.close();

  host.send({ type: 'start' });

  // Drive the game: each player waits for state, moves when it's their turn
  const t0 = Date.now();
  let turns = 0, wordsPlayed = 0, passes = 0, finalState = null;
  const seenScores = {};

  let lastCurrent = null;
  outer: for (;;) {
    // All clients receive state; use host's stream as the reference
    let msg;
    try {
      msg = await host.next(20000);
    } catch (e) {
      // A stall here means a bot move was rejected by the server — that is a
      // bot/engine disagreement bug. Flag it and pass to keep the game going.
      check(false, `stalled waiting for state (likely rejected bot move); passing`);
      if (!lastCurrent) throw e;
      lastCurrent.client.send({ type: 'pass' });
      continue;
    }
    if (msg.type === 'played') { wordsPlayed++; continue; }
    if (msg.type !== 'state') continue;
    const st = msg.state;
    if (st.scores) for (const c of st.players) seenScores[c] = st.scores[c];

    if (st.phase === 'over') { finalState = st; break outer; }
    turns++;
    if (turns > 400) { check(false, 'game exceeded 400 turns (possible livelock)'); break; }

    const current = players.find((p) => p.color === st.current);
    lastCurrent = current;
    // Rebuild a rich engine state from the public state for the bot brain
    const engineState = publicToEngine(st);
    const move = game.findMove(engineState, current.color, BOT_WORDS);
    if (move) {
      current.client.send({ type: 'play', ...move, word: move.word });
    } else {
      passes++;
      current.client.send({ type: 'pass' });
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check(finalState !== null, 'game reached game-over');
  if (finalState) {
    check(finalState.winner && finalState.players.includes(finalState.winner), 'winner is a seated player');
    check(finalState.finalScores && Object.keys(finalState.finalScores).length === numPlayers, 'final scores for all players');
    const sorted = finalState.players.slice().sort((a, b) => finalState.finalScores[b] - finalState.finalScores[a]);
    check(sorted[0] === finalState.winner || finalState.finalScores[sorted[0]] === finalState.finalScores[finalState.winner], 'winner has top score');
    // Bandwidth: host connection receives every broadcast — the worst case
    const kb = (host.stats.bytes / 1024).toFixed(1);
    const perTurn = (host.stats.bytes / Math.max(turns, 1) / 1024).toFixed(2);
    const maxKb = (host.stats.maxMsg / 1024).toFixed(2);
    console.log(`  finished in ${turns} turns (${wordsPlayed} words, ${passes} passes) in ${secs}s`);
    console.log(`  bandwidth: ${kb} KB total to host, ~${perTurn} KB/turn, largest message ${maxKb} KB`);
    console.log(`  winner: ${finalState.winner}  finals: ${JSON.stringify(finalState.finalScores)}`);
    check(host.stats.maxMsg < 64 * 1024, 'largest ws message under 64 KB');
    results.push({ game: gameNo, players: numPlayers, turns, wordsPlayed, passes, secs, winner: finalState.winner, finals: finalState.finalScores, kb, perTurn, maxKb });
  }

  host.close();
  for (const p of players) p.client.close();
}

// The public state only exposes stack tops; give the bot an engine-shaped
// state where hidden lower pyramids are unknown (they can't be used anyway).
function publicToEngine(st) {
  return {
    cells: st.cells.map((row) =>
      row.map((c) => ({
        printed: c.p,
        stack: c.t ? [...Array(c.n - 1).fill({ l: '?', v: 0, o: 'hidden' }), { l: c.t.l, v: c.t.v, o: c.t.o }] : [],
      }))
    ),
    players: st.players,
    turn: st.turn,
    phase: st.phase,
  };
}

async function main() {
  let proc = null;
  if (REMOTE_URL) {
    console.log(`Testing LIVE deployment: ${BASE}`);
    console.log('(free-tier hosts may need ~30-60s to wake from sleep on the first request)');
  } else {
    console.log('Starting local server…');
    proc = spawn('node', ['server/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => { process.stdout.write('  [server] ' + d); if (String(d).includes('listening')) resolve(); });
      proc.on('exit', (c) => reject(new Error('server exited early: ' + c)));
      setTimeout(() => reject(new Error('server start timeout')), 15000);
    });
  }

  // Free-tier hosts can be asleep; retry the wake-up request for up to ~90s
  let health;
  const wakeDeadline = Date.now() + 90000;
  for (;;) {
    try {
      health = await httpGet(`${BASE}/health`);
      if (health.status === 200) break;
    } catch { /* connection refused while waking up */ }
    if (Date.now() > wakeDeadline) { health = health || { status: 0, body: '' }; break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  check(health.status === 200 && JSON.parse(health.body || '{}').ok, 'health endpoint');
  for (const page of ['/', '/host.html', '/play.html', '/style.css', '/board.js']) {
    const res = await httpGet(BASE + page);
    check(res.status === 200 && res.body.length > 100, `page serves: ${page}`);
  }

  try {
    const sizes = [2, 3, 4, 2, 3]; // player-count mix across the 5 games
    for (let i = 0; i < NUM_GAMES; i++) {
      await playGame(i + 1, sizes[i % sizes.length]);
    }
  } finally {
    if (proc) proc.kill();
  }

  console.log('\n================ SUMMARY ================');
  for (const r of results) {
    console.log(`Game ${r.game} (${r.players}p): winner ${r.winner}, ${r.turns} turns, ${r.wordsPlayed} words, ${r.secs}s, ${r.kb} KB (${r.perTurn} KB/turn, max msg ${r.maxKb} KB), finals ${JSON.stringify(r.finals)}`);
  }
  console.log(failures === 0 ? `\nALL CHECKS PASSED (${NUM_GAMES} games)` : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 && results.length === NUM_GAMES ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
