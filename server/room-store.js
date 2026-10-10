'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const VERSION = 1;
const CODE = /^[A-HJ-NP-Z]{4}$/;
const COLORS = new Set(['red', 'blue', 'green', 'yellow']);
const HASH = /^[a-f0-9]{64}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

function acquire(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockFile = `${file}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return {
        release() {
          fs.closeSync(fd);
          try {
            const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
            if (owner.pid === process.pid) fs.unlinkSync(lockFile);
          } catch {}
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); }
      catch { throw new Error(`Room store lock is unreadable (${lockFile}); inspect it before removing it.`); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error(`Room store lock has an invalid owner (${lockFile}); inspect it before removing it.`);
      try { process.kill(owner.pid, 0); }
      catch (probeError) {
        if (probeError.code !== 'ESRCH') throw error;
        fs.unlinkSync(lockFile);
        continue;
      }
      throw new Error(`Room store is already in use by process ${owner.pid} (${lockFile}); only one server instance may write this file.`);
    }
  }
  throw new Error(`Could not acquire room store lock (${lockFile}).`);
}

function secureFile(file) {
  if (process.platform === 'win32') return; // Windows ACLs are inherited from the protected application data directory.
  fs.chmodSync(file, 0o600);
}

function snapshot(room) {
  return {
    code: room.code,
    hostTokenHash: room.hostTokenHash,
    players: room.players.map((p) => ({
      name: p.name, color: p.color, bot: !!p.bot,
      ...(p.tokenHash ? { tokenHash: p.tokenHash } : {}),
      ...(p.disconnectedAt ? { disconnectedAt: p.disconnectedAt } : {}),
    })),
    phase: room.phase,
    state: room.state,
    gameId: room.gameId || null,
    revision: room.revision || 0,
    botDelayMs: room.botDelayMs,
    created: room.created,
    lastSeen: room.lastSeen || room.created,
    hostGoneAt: room.hostGoneAt || null,
  };
}

function validRoom(room, index) {
  const bad = (why) => { throw new Error(`Invalid room checkpoint ${index}: ${why}`); };
  if (!object(room) || !CODE.test(room.code || '')) bad('bad code');
  if (!HASH.test(room.hostTokenHash || '')) bad('bad host credential hash');
  if (!Array.isArray(room.players) || room.players.length > 4) bad('bad players');
  const colors = new Set();
  for (const player of room.players) {
    if (!object(player) || typeof player.name !== 'string' || player.name.length > 24 || !COLORS.has(player.color) || colors.has(player.color)) bad('bad player record');
    colors.add(player.color);
    if (typeof player.bot !== 'boolean' || (!player.bot && !HASH.test(player.tokenHash || ''))) bad('bad player credential hash');
  }
  if (!['lobby', 'playing'].includes(room.phase)) bad('bad room phase');
  if (!Number.isFinite(room.created) || !Number.isFinite(room.lastSeen) || !Number.isInteger(room.revision) || room.revision < 0) bad('bad timestamps or revision');
  if (room.hostGoneAt !== null && !Number.isFinite(room.hostGoneAt)) bad('bad host grace timestamp');
  if (room.state !== null) {
    if (!object(room.state) || !Array.isArray(room.state.cells) || room.state.cells.length !== 10 || room.state.cells.some((row) => !Array.isArray(row) || row.length !== 10)) bad('bad board state');
    if (!Array.isArray(room.state.players) || room.state.players.length < 2 || (room.state.phase === 'playing' && room.state.players.some((color) => !colors.has(color))) || // a finished game keeps seats whose phones have since left
       !Number.isInteger(room.state.turn) || room.state.turn < 0 || room.state.turn >= room.state.players.length || !['playing', 'over'].includes(room.state.phase)) bad('bad game state');
  } else if (room.phase === 'playing') bad('playing room has no game state');
}

function load(file) {
  let data;
  try { data = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  let parsed;
  try { parsed = JSON.parse(data); }
  catch (error) { throw new Error(`Cannot read room checkpoint ${file}: ${error.message}`); }
  if (!object(parsed) || parsed.version !== VERSION || !Array.isArray(parsed.rooms)) {
    throw new Error(`Unsupported or invalid room checkpoint ${file}`);
  }
  secureFile(file);
  parsed.rooms.forEach(validRoom);
  return clone(parsed.rooms);
}

function save(file, rooms) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  const data = JSON.stringify({ version: VERSION, rooms: [...rooms.values()].map(snapshot) });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    secureFile(temp);
    if (process.platform === 'win32' && fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
    secureFile(file);
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

module.exports = { acquire, load, save, snapshot, VERSION };
