'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquire, load, save, snapshot, VERSION } = require('../server/room-store');

function fixture() {
  const host = { readyState: 1 };
  const playerSocket = { readyState: 1 };
  const room = {
    code: 'ABCD', hostTokenHash: 'a'.repeat(64), host, players: [
      { ws: playerSocket, name: 'Ada', color: 'red', bot: false, tokenHash: 'b'.repeat(64) },
      { ws: null, name: 'Sphinx (AI)', color: 'blue', bot: true },
    ],
    phase: 'playing', state: { players: ['red', 'blue'], turn: 0, phase: 'playing', cells: Array.from({length:10}, () => Array.from({length:10}, () => ({printed:null,stack:[]}))) },
    gameId: 'game-id', revision: 4, botDelayMs: 0, created: 100, lastSeen: 200,
  };
  return room;
}

test('room snapshots omit sockets, retain game credentials as hashes, and round-trip atomically', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rooms.json');
  const room = fixture();
  const serialized = snapshot(room);
  assert.equal('host' in serialized, false);
  assert.equal('ws' in serialized.players[0], false);
  assert.equal(serialized.players[0].tokenHash, 'b'.repeat(64));
  const rooms = new Map([[room.code, room]]);
  save(file, rooms);
  assert.deepEqual(load(file), [serialized]);
  const checkpoint = load(file);
  room.state.phase = 'over';
  assert.equal(checkpoint[0].state.phase, 'playing', 'loaded checkpoint is detached from mutable server game state');
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')).length, 0);
  assert.ok(!JSON.stringify(load(file)).includes('readyState'), 'snapshot does not persist socket fields');
});

test('store lock prevents concurrent writers and permits recovery after the old process exits', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rooms.json');
  const lock = acquire(file);
  assert.throws(() => acquire(file), /already in use/);
  lock.release();
  const second = acquire(file);
  second.release();
});

test('missing checkpoint is an empty install; malformed or unsupported checkpoint fails closed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rooms.json');
  assert.deepEqual(load(file), []);
  fs.writeFileSync(file, '{bad');
  assert.throws(() => load(file), /Cannot read room checkpoint/);
  fs.writeFileSync(file, JSON.stringify({ version: VERSION + 1, rooms: [] }));
  assert.throws(() => load(file), /Unsupported or invalid/);
});

test('invalid or partial room records are rejected rather than silently dropped', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rooms.json');
  fs.writeFileSync(file, JSON.stringify({ version: VERSION, rooms: [{ code: 'ABCD' }] }));
  assert.throws(() => load(file), /host credential hash/);
});

test('a finished game whose third player has left still reloads (state keeps seats the room dropped)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rooms.json');
  const room = fixture();
  room.state.players = ['red', 'blue', 'green']; // green left after the game ended
  room.state.phase = 'over';
  save(file, new Map([[room.code, room]]));
  assert.equal(load(file).length, 1);
  // ...but a game still being played must keep every seated colour in the room.
  room.state.phase = 'playing';
  save(file, new Map([[room.code, room]]));
  assert.throws(() => load(file), /bad game state/);
});
