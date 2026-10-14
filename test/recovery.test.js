'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const children = new Set();
const clientSockets = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(t, storePath) {
  const output = [];
  const child = spawn(process.execPath, ['-e',
    "const {server}=require('./server/index'); server.on('listening',()=>process.send({port:server.address().port}));",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: '', ROOM_STORE_PATH: storePath, GONE_MS: '60000' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  children.add(child);
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  t.after(async () => {
    for (const process of children) {
      if (process.exitCode === null) process.kill();
      children.delete(process);
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill();
      reject(new Error(`startup timed out: ${output.join('')}`));
    }, 8000);
    child.once('message', (m) => { clearTimeout(timeout); resolve(m.port); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${output.join('')}`)); });
  });
  return { child, port };
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  clientSockets.add(ws);
  const seen = [];
  const waiters = [];
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    seen.push(message);
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws, seen,
    send: (message) => ws.send(JSON.stringify(message)),
    next: (predicate, ms = 5000) => {
      const found = seen.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timeout: null };
        waiter.timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('timed out waiting for websocket message'));
        }, ms);
        waiters.push(waiter);
      });
    },
    close: () => ws.close(),
  };
}

test('server restart restores ongoing room, host and seats using their private credentials', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-recovery-'));
  const storePath = path.join(dir, 'rooms.json');
  t.after(() => {
    for (const ws of clientSockets) ws.terminate();
    clientSockets.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let { child, port } = await startServer(t, storePath);
  let host = await connect(port);
  host.send({ type: 'host_create' });
  const hosted = await host.next((m) => m.type === 'hosted');
  const players = [];
  for (const name of ['Ada', 'Turing']) {
    const player = await connect(port);
    player.send({ type: 'join', code: hosted.code, name });
    const joined = await player.next((m) => m.type === 'joined');
    players.push({ ...player, token: joined.token, color: joined.color, name });
  }
  host.send({ type: 'start' });
  const before = (await host.next((m) => m.type === 'state' && m.state.gameId)).state;
  assert.equal(before.phase, 'playing');
  assert.equal(fs.existsSync(storePath), true, 'room is checkpointed to disk');

  for (const player of players) player.ws.terminate();
  child.kill();
  const restartedAfterExit = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('old server process did not exit before restart')), 5000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  await restartedAfterExit;
  await sleep(100); // allow Windows to release the killed process's file handles before relaunch

  ({ child, port } = await startServer(t, storePath));
  host = await connect(port);
  host.send({ type: 'host_create', resume: hosted.code, token: hosted.token });
  const refusedHost = await connect(port);
  refusedHost.send({ type: 'host_create', resume: hosted.code });
  assert.equal((await refusedHost.next((m) => m.type === 'error')).code, 'HOST_AUTH');
  const resumedHost = await host.next((m) => m.type === 'hosted');
  assert.equal(resumedHost.code, hosted.code);
  assert.equal(resumedHost.token, hosted.token);
  const resumedPlayers = [];
  for (const player of players) {
    const socket = await connect(port);
    socket.send({ type: 'join', code: hosted.code, name: player.name, token: player.token });
    const joined = await socket.next((m) => m.type === 'joined');
    assert.equal(joined.color, player.color);
    resumedPlayers.push(socket);
  }
  const stateResponses = await Promise.all(resumedPlayers.map((player) => player.next((m) => m.type === 'state' && m.state.gameId === before.gameId)));
  const after = stateResponses[0].state;
  assert.deepEqual(after, before, 'board, turn, revision, log, and hidden scores survive restart exactly');
  assert.deepEqual(stateResponses[1].state, before, 'all rejoined players see the restored authoritative state');

  host.close();
  for (const player of resumedPlayers) player.close();
});
