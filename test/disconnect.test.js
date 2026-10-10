'use strict';
// A turn belonging to a dropped phone is skipped (counted as a pass) after
// GONE_MS; reconnecting with the seat credential before then cancels it.
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
  return { client };
}

// host + one AI + one human in a started game, returning who is who
async function setup(t, env) {
  const { client } = await startServer(t, env);
  const host = await client();
  host.send({ type: 'host_create', botDelayMs: 0 });
  const hosted = await host.wait((m) => m.type === 'hosted');
  host.send({ type: 'add_bot' });
  const human = await client();
  human.send({ type: 'join', code: hosted.code, name: 'Ann' });
  const joined = await human.wait((m) => m.type === 'joined');
  host.send({ type: 'start' });
  return { client, host, human, code: hosted.code, joined };
}

test('a dropped phone is skipped after GONE_MS when it is their turn', { timeout: 20000 }, async (t) => {
  const { host, human, joined } = await setup(t, { GONE_MS: '500' });
  await human.wait((m) => m.type === 'state' && m.state.current === joined.color);
  human.ws.terminate();
  const skipped = await host.wait((m) => m.type === 'skipped' && m.color === joined.color, 5000);
  assert.equal(skipped.color, joined.color);
});

test('reconnecting with the seat credential before GONE_MS cancels the skip', { timeout: 20000 }, async (t) => {
  const { client, host, human, code, joined } = await setup(t, { GONE_MS: '1500' });
  await human.wait((m) => m.type === 'state' && m.state.current === joined.color);
  human.ws.terminate();
  await new Promise((r) => setTimeout(r, 200));
  const back = await client();
  back.send({ type: 'join', code, name: 'Ann', token: joined.token });
  const rejoined = await back.wait((m) => m.type === 'joined');
  assert.equal(rejoined.color, joined.color, 'same seat');
  await new Promise((r) => setTimeout(r, 2200));
  assert.ok(!host.seen.some((m) => m.type === 'skipped'), 'turn must not be skipped after a timely rejoin');
});

test('without the credential, the dropped seat cannot be reclaimed by name', { timeout: 20000 }, async (t) => {
  const { client, host, human, code, joined } = await setup(t, { GONE_MS: '5000' });
  await human.wait((m) => m.type === 'state' && m.state.current === joined.color);
  human.ws.terminate();
  await new Promise((r) => setTimeout(r, 200));
  const thief = await client();
  thief.send({ type: 'join', code, name: 'Ann' });
  const err = await thief.wait((m) => m.type === 'error');
  assert.equal(err.code, 'SEAT_GONE');
  assert.ok(host.seen.length > 0);
});

// Abuse limits share this harness: many sockets from one IP.
test('the 6th room created from one address in a minute is refused', { timeout: 20000 }, async (t) => {
  const { client } = await startServer(t, {});
  let refused = null;
  for (let i = 0; i < 6; i++) {
    const c = await client();
    c.send({ type: 'host_create' });
    const m = await c.wait((x) => x.type === 'hosted' || x.type === 'error');
    if (m.type === 'error') refused = m;
  }
  assert.ok(refused && /Too many rooms/.test(refused.error));
});

test('repeated wrong room codes lock out guessing from that address', { timeout: 20000 }, async (t) => {
  const { client } = await startServer(t, {});
  const c = await client();
  let last;
  for (let i = 0; i < 11; i++) {
    c.send({ type: 'join', code: 'ZZZ' + String.fromCharCode(65 + i), name: 'x' });
    last = await c.wait((m) => m.type === 'error' && !m.__seen && (m.__seen = true));
  }
  assert.match(last.error, /Too many wrong codes/);
});
