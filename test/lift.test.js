'use strict';
// Building a word on a phone: the `lift` peek under a stack top, and the
// host's own reserved seat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

async function startServer(t, env) {
  const output = [];
  // Must be its own subdirectory, not os.tmpdir() itself: save() chmods the
  // checkpoint's directory to 0700, and a shared /tmp can't be locked down
  // that way on CI (EPERM) or on any box where other processes use /tmp.
  const storeDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'pyramids-disconnect-'));
  const storePath = path.join(storeDir, 'rooms.json');
  const child = spawn(process.execPath, ['-e',
    "const {server}=require('./server/index'); server.on('listening',()=>process.send({port:server.address().port}));",
  ], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: '', ROOM_STORE_PATH: storePath, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout.on('data', (c) => output.push(String(c)));
  child.stderr.on('data', (c) => output.push(String(c)));
  const sockets = new Set();
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; }
    require('fs').rmSync(storeDir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('startup timeout: ' + output.join(''))), 8000);
    child.once('message', (m) => { clearTimeout(to); resolve(m.port); });
    child.once('exit', (code) => { clearTimeout(to); reject(new Error('server exited ' + code + ': ' + output.join(''))); });
  });
  const client = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.add(ws);
    const seen = [];
    const waiters = [];
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      seen.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.res(m); }
    });
    await new Promise((res) => ws.once('open', res));
    return {
      ws, seen,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 6000) => {
        const hit = seen.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const w = { pred, res, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error('timed out waiting for message')); }, ms) };
          waiters.push(w);
        });
      },
    };
  };
  return { client, port };
}

const { message } = require('../server/validate');
const game = require('../server/game');

test('lift shape is validated: cells, game id, revision', () => {
  assert.ok(message({ type: 'lift', cells: [{ r: 1, c: 2 }], gameId: 'g', revision: 0 }).msg);
  for (const bad of [
    { type: 'lift', cells: 'x', gameId: 'g', revision: 0 },
    { type: 'lift', cells: [{ r: 10, c: 0 }], gameId: 'g', revision: 0 },
    { type: 'lift', cells: [{ r: 0, c: 0 }], revision: 0 },
    { type: 'lift', cells: new Array(11).fill({ r: 0, c: 0 }), gameId: 'g', revision: 0 },
  ]) assert.ok(message(bad).error, JSON.stringify(bad).slice(0, 60));
});

test('peekUnder shows the piece beneath a top and never changes the game', () => {
  const st = game.createGame(['red', 'blue']);
  const snapshot = JSON.stringify(st.cells);
  let stacked = null;
  st.cells.forEach((row, r) => row.forEach((cell, c) => { if (!stacked && cell.stack.length >= 2) stacked = [r, c]; }));
  const [r, c] = stacked;
  const stack = st.cells[r][c].stack;
  const out = game.peekUnder(st, [{ r, c }]);
  assert.equal(out[0].under.l, stack[stack.length - 2].l);
  assert.equal(JSON.stringify(st.cells), snapshot, 'peeking does not mutate the game');
  st.cells[r][c].stack = [stack[stack.length - 1]];
  assert.equal(game.peekUnder(st, [{ r, c }])[0].under, null, 'a lone piece has nothing under it');
});

test('only the player whose turn it is can lift, and a stale board is refused', { timeout: 20000 }, async (t) => {
  const { client } = await startServer(t, {});
  const host = await client();
  host.send({ type: 'host_create' });
  const hosted = await host.wait((m) => m.type === 'hosted');
  const a = await client(), b = await client();
  a.send({ type: 'join', code: hosted.code, name: 'Ann' });
  const aj = await a.wait((m) => m.type === 'joined');
  b.send({ type: 'join', code: hosted.code, name: 'Ben' });
  await b.wait((m) => m.type === 'joined');
  host.send({ type: 'start' });
  const st = (await a.wait((m) => m.type === 'state')).state;
  const mover = st.current === aj.color ? a : b, other = mover === a ? b : a;
  let spot = null;
  st.cells.forEach((row, r) => row.forEach((cell, c) => { if (!spot && cell.t && cell.n >= 2) spot = { r, c }; }));
  other.send({ type: 'lift', requestId: 1, gameId: st.gameId, revision: st.revision, cells: [spot] });
  mover.send({ type: 'lift', requestId: 2, gameId: st.gameId, revision: st.revision, cells: [spot] });
  const got = await mover.wait((m) => m.type === 'lift' && m.requestId === 2);
  assert.equal(got.ok, true);
  assert.equal(got.under.length, 1);
  assert.ok(/^[a-z]$/.test(got.under[0].under.l));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!other.seen.some((m) => m.type === 'lift'), 'a player who is not on turn gets no peek');
  mover.send({ type: 'lift', requestId: 3, gameId: st.gameId, revision: st.revision + 5, cells: [spot] });
  const stale = await mover.wait((m) => m.type === 'lift' && m.requestId === 3);
  assert.equal(stale.ok, false);
});

test('the host gets a reserved seat; unclaimed, it makes way and the game still starts', { timeout: 20000 }, async (t) => {
  const { client } = await startServer(t, {});
  const host = await client();
  host.send({ type: 'host_create' });
  const hosted = await host.wait((m) => m.type === 'hosted');
  assert.match(hosted.playUrl, /\/play\.html\?room=[A-Z]{4}#seat=/);
  const room = await host.wait((m) => m.type === 'room');
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].hostSeat, true);
  // two guests start without the host ever sitting down
  const a = await client(), b = await client();
  a.send({ type: 'join', code: hosted.code, name: 'Ann' });
  const aj = await a.wait((m) => m.type === 'joined');
  b.send({ type: 'join', code: hosted.code, name: 'Ben' });
  await b.wait((m) => m.type === 'joined');
  assert.notEqual(aj.color, 'red', 'red is held for the host');
  host.send({ type: 'start' });
  const st = (await a.wait((m) => m.type === 'state')).state;
  assert.deepEqual(st.players.slice().sort(), ['blue', 'green'], 'the unclaimed host seat was dropped');
});

test('the host sits down with the seat link credential and plays as red', { timeout: 20000 }, async (t) => {
  const { client } = await startServer(t, {});
  const host = await client();
  host.send({ type: 'host_create' });
  const hosted = await host.wait((m) => m.type === 'hosted');
  const token = hosted.playUrl.split('#seat=')[1];
  const me = await client();
  me.send({ type: 'join', code: hosted.code, name: 'Hana', token });
  const joined = await me.wait((m) => m.type === 'joined');
  assert.equal(joined.color, 'red');
  assert.equal(joined.name, 'Hana');
  const thief = await client();
  thief.send({ type: 'join', code: hosted.code, name: 'Hana', token: 'wrong' });
  const err = await thief.wait((m) => m.type === 'joined' || m.type === 'error');
  assert.notEqual(err.color, 'red', 'a wrong credential does not get the host seat');
  const b = await client();
  b.send({ type: 'join', code: hosted.code, name: 'Ben' });
  await b.wait((m) => m.type === 'joined');
  host.send({ type: 'start' });
  const st = (await b.wait((m) => m.type === 'state')).state;
  assert.ok(st.players.includes('red'), 'the claimed host seat plays');
});
