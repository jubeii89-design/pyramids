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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Host + two players, game started. Returns who is on turn and cells to spell with.
async function setup(t) {
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
  const moverColor = st.current;
  let own = null, empty = null;
  const house = [];
  st.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.t && cell.t.o === moverColor && cell.n >= 2 && !own) own = { r, c };
    if (cell.t && cell.t.o === 'house' && c >= 2 && house.length < 2) house.push({ r, c });
    if (!cell.t && !cell.p && !empty) empty = { r, c };
  }));
  const draft = (extra) => ({ type: 'draft', gameId: st.gameId, revision: st.revision, dir: 'H', items: [own, house[0], house[1]], ...extra });
  return { client, host, hosted, a, b, mover, other, moverColor, st, own, house, empty, draft };
}

test('only the player on turn is mirrored; the relay carries derived public fields only', { timeout: 20000 }, async (t) => {
  const s = await setup(t);
  s.other.send(s.draft());
  await sleep(300);
  assert.ok(!s.host.seen.some((m) => m.type === 'draft'), 'a player off turn is not relayed');
  s.mover.send(s.draft());
  const gh = await s.host.wait((m) => m.type === 'draft');
  const go = await s.other.wait((m) => m.type === 'draft');
  assert.equal(gh.color, s.moverColor);
  assert.equal(gh.items.length, 3);
  gh.items.forEach((it, i) => {
    const src = [s.own, ...s.house][i];
    assert.deepEqual(Object.keys(it).sort(), ['b', 'c', 'l', 'r']);
    assert.equal(it.l, s.st.cells[src.r][src.c].t.l);
    assert.equal(it.b, i === 0 ? 0 : 1);
  });
  assert.deepEqual(gh.lifted, [{ r: s.own.r, c: s.own.c }]);
  assert.deepEqual(gh.start, { r: s.house[0].r, c: s.house[0].c - 1 });
  assert.deepEqual(go, gh);
  assert.ok(!JSON.stringify(gh).includes('under'));
  assert.ok(!s.mover.seen.some((m) => m.type === 'draft'), 'the sender gets no echo');
});

test('draft does not change the game; stale revisions and empty squares are ignored', { timeout: 20000 }, async (t) => {
  const s = await setup(t);
  s.mover.send(s.draft({ revision: s.st.revision + 3 }));
  await sleep(80);
  s.mover.send(s.draft({ items: [s.own, s.empty, s.house[0]] }));
  await sleep(300);
  assert.ok(!s.host.seen.some((m) => m.type === 'draft'));
  s.mover.send(s.draft());
  await s.host.wait((m) => m.type === 'draft');
  const states = s.host.seen.filter((m) => m.type === 'state');
  assert.equal(states.length, 1, 'no extra state broadcast');
  assert.equal(states[0].state.revision, s.st.revision);
});

test('bursts under 50 ms are dropped; an empty draft always relays a clear', { timeout: 20000 }, async (t) => {
  const s = await setup(t);
  s.mover.send(s.draft());
  s.mover.send(s.draft({ items: [s.house[0], s.house[1], s.own] }));
  s.mover.send(s.draft({ items: [] }));
  await sleep(400);
  const drafts = s.host.seen.filter((m) => m.type === 'draft');
  assert.equal(drafts.length, 2, 'second non-empty draft dropped, clear passed');
  assert.equal(drafts[0].items.length, 3);
  assert.deepEqual(drafts[1].items, []);
});

test('a draft from an old revision is ignored after a pass', { timeout: 20000 }, async (t) => {
  const s = await setup(t);
  s.mover.send(s.draft());
  await s.host.wait((m) => m.type === 'draft');
  s.mover.send({ type: 'pass' });
  await s.host.wait((m) => m.type === 'state' && m.state.revision === s.st.revision + 1);
  await sleep(100);
  const before = s.host.seen.filter((m) => m.type === 'draft').length;
  s.mover.send(s.draft());
  await sleep(300);
  assert.equal(s.host.seen.filter((m) => m.type === 'draft').length, before);
});

test('a resumed host gets the draft replayed; the owner leaving sends a clear', { timeout: 20000 }, async (t) => {
  const s = await setup(t);
  s.mover.send(s.draft());
  await s.host.wait((m) => m.type === 'draft');
  s.host.ws.terminate();
  await sleep(200);
  const host2 = await s.client();
  host2.send({ type: 'host_create', resume: s.hosted.code, token: s.hosted.token });
  const replay = await host2.wait((m) => m.type === 'draft');
  assert.equal(replay.items.length, 3);
  assert.equal(replay.color, s.moverColor);
  s.mover.ws.terminate();
  const cleared = await host2.wait((m) => m.type === 'draft' && m.items.length === 0);
  assert.equal(cleared.color, s.moverColor);
  assert.ok(await s.other.wait((m) => m.type === 'draft' && m.items.length === 0));
});
