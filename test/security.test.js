'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

test('public room protocol keeps recovery credentials private and rejects unsafe input', { timeout: 20000 }, async (t) => {
  const clients = new Set();
  const storePath = path.join(require('os').tmpdir(), `pyramids-security-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const output = [];
  const child = spawn(process.execPath, ['-e',
    "const {server}=require('./server/index'); server.on('listening',()=>process.send({port:server.address().port}));",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: '', ROOM_STORE_PATH: storePath },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    for (const suffix of ['', '.lock']) { try { require('fs').unlinkSync(storePath + suffix); } catch {} }
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output.join('')}`)), 8000);
    child.once('message', (message) => { clearTimeout(timeout); resolve(message.port); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output.join('')}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const snapshots = [];

  async function connect(options) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', options);
    const queue = [];
    const waiting = [];
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.type === 'room' || message.type === 'state') snapshots.push(message);
      const index = waiting.findIndex((waiter) => waiter.predicate(message));
      if (index !== -1) {
        const [waiter] = waiting.splice(index, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
      } else queue.push(message);
    });
    const client = {
      ws, closed,
      send: (message) => ws.send(JSON.stringify(message)),
      next: (predicate) => {
        if (typeof predicate === 'string') {
          const type = predicate;
          predicate = (message) => message.type === type;
        }
        const index = queue.findIndex(predicate);
        if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const waiter = { predicate, resolve, timeout: null };
          waiter.timeout = setTimeout(() => {
            const pending = waiting.indexOf(waiter);
            if (pending !== -1) waiting.splice(pending, 1);
            reject(new Error(`Timed out waiting for protocol message. Server output: ${output.join('')}`));
          }, 3000);
          waiting.push(waiter);
        });
      },
      close: async () => { ws.close(); return closed; },
    };
    clients.add(client);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return client;
  }

  let host = await connect();
  host.send({ type: 'host_create', origin: 'https://attacker.invalid' });
  const hosted = await host.next('hosted');
  const secrets = [hosted.token];
  assert.equal(typeof hosted.token, 'string');
  assert.ok(hosted.token.length >= 32);

  await t.test('join URL and decoded QR ignore the message origin', () => {
    assert.equal(hosted.joinUrl, `${base}/play.html?room=${hosted.code}`);
    const png = PNG.sync.read(Buffer.from(hosted.qr.split(',')[1], 'base64'));
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(qr, 'server QR must decode');
    assert.equal(qr.data, hosted.joinUrl);
    assert.equal(qr.data.includes(hosted.token), false);
  });

  await t.test('disconnected host recovery requires its private credential', async () => {
    await host.close();
    const recovery = await connect();
    recovery.send({ type: 'host_create', resume: hosted.code });
    assert.match((await recovery.next('error')).error, /credential/i);
    recovery.send({ type: 'host_create', resume: hosted.code, token: 'incorrect-token' });
    assert.match((await recovery.next('error')).error, /credential/i);
    recovery.send({ type: 'host_create', resume: hosted.code, token: hosted.token });
    const resumed = await recovery.next('hosted');
    assert.equal(resumed.code, hosted.code);
    assert.equal(resumed.token, hosted.token);
    assert.equal(resumed.joinUrl, hosted.joinUrl);
    host = recovery;
  });

  await t.test('host cannot overwrite its role by joining its own lobby', async () => {
    host.send({ type: 'join', code: hosted.code, name: 'Host impostor' });
    const response = await host.next((message) => message.type === 'error' || message.type === 'joined');
    assert.equal(response.type, 'error', 'a host socket must retain exclusive host authority');
  });

  const player = await connect();
  player.send({ type: 'join', code: hosted.code, name: 'Alpha' });
  const joined = await player.next('joined');
  const second = await connect();
  second.send({ type: 'join', code: hosted.code, name: 'Bravo' });
  const joinedSecond = await second.next('joined');
  secrets.push(joined.token, joinedSecond.token);
  assert.equal(new Set(secrets).size, 3, 'each session has a distinct credential');
  host.send({ type: 'start' });
  const initial = (await host.next('state')).state;

  await t.test('name alone cannot reclaim a seat; valid token retains original identity and board', async () => {
    await player.close();
    await host.next((message) => message.type === 'room' && message.players.some((p) => p.name === 'Alpha' && !p.connected));
    const recovery = await connect();
    recovery.send({ type: 'join', code: hosted.code, name: 'Alpha' });
    assert.equal((await recovery.next('error')).type, 'error');
    recovery.send({ type: 'join', code: hosted.code, name: 'Alpha', token: hosted.token });
    assert.equal((await recovery.next('error')).type, 'error', 'a host token does not authorize a player seat');
    recovery.send({ type: 'join', code: hosted.code, name: 'Different name', token: joined.token });
    const resumed = await recovery.next('joined');
    assert.equal(resumed.color, joined.color);
    assert.equal(resumed.name, 'Alpha');
    assert.equal(resumed.token, joined.token);
    assert.deepEqual((await recovery.next('state')).state, initial);
  });

  await t.test('room and board broadcasts exclude tokens and credential hashes', () => {
    assert.ok(snapshots.some((message) => message.type === 'room'));
    assert.ok(snapshots.some((message) => message.type === 'state'));
    for (const snapshot of snapshots) {
      const text = JSON.stringify(snapshot);
      for (const secret of secrets) assert.equal(text.includes(secret), false, 'private token leaked in a broadcast');
      assert.doesNotMatch(text, /"[^"]*(?:token|credential|secret)[^"]*"\s*:/i);
    }
  });

  await t.test('null, malformed JSON and nonobject messages leave the connection usable', async () => {
    const client = await connect();
    for (const raw of ['null', '{bad', '42', '"string"', '[]', '{}']) client.ws.send(raw);
    client.send({ type: 'host_create' });
    assert.match((await client.next('hosted')).code, /^[A-Z]{4}$/);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  await t.test('oversized frames close only the offending connection', async () => {
    const client = await connect();
    client.ws.send('x'.repeat(9000));
    assert.equal(await client.closed, 1009);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const survivor = await connect();
    survivor.send({ type: 'host_create' });
    assert.match((await survivor.next('hosted')).code, /^[A-Z]{4}$/);
  });

  await t.test('a foreign browser origin is rejected', async () => {
    const foreign = await connect({ origin: 'https://attacker.invalid' });
    assert.equal(await foreign.closed, 1008);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
