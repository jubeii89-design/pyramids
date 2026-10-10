'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const game = require('./game');
const security = require('./security');
const validate = require('./validate');
const { clientIp, createLimiter } = require('./limits');
const { originAllowed, inviteOrigin, assertConfigured } = require('./origin');
const roomStore = require('./room-store');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOM_STORE_PATH = process.env.ROOM_STORE_PATH || path.join(__dirname, '..', 'data', 'rooms.json');
const storeLock = roomStore.acquire(ROOM_STORE_PATH);
const roomSnapshotStore = roomStore.load(ROOM_STORE_PATH);
const previousLifecycle = new Map(roomSnapshotStore.map((saved) => [saved.code, { lastSeen: saved.lastSeen, hostGoneAt: saved.hostGoneAt }]));

// Dictionary
const words = fs
  .readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);
const DICT = new Set(words);
// Bot vocabulary: short, common-shaped words keep move search fast
const BOT_WORDS = words.filter((w) => w.length >= 3 && w.length <= 6);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });

const rooms = new Map(); // code -> room
const limiter = createLimiter();
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP) || 20;
const GUESS_LIMIT = 10, GUESS_WINDOW_MS = 60 * 1000; // failed room joins per IP per minute
const HOST_LIMIT = 5, HOST_WINDOW_MS = 60 * 1000;     // new rooms per IP per minute
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function persistRooms() {
  roomStore.save(ROOM_STORE_PATH, rooms);
  roomSnapshotStore.length = 0;
  roomSnapshotStore.push(...roomStore.load(ROOM_STORE_PATH));
  previousLifecycle.clear();
  for (const room of rooms.values()) previousLifecycle.set(room.code, { lastSeen: room.lastSeen || room.created, hostGoneAt: room.hostGoneAt || null });
}

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function roomSnapshot(room) {
  return {
    type: 'room',
    code: room.code,
    phase: room.phase,
    players: room.players.map((p) => ({
      name: p.name,
      color: p.color,
      bot: !!p.bot,
      connected: !!(p.bot || (p.ws && p.ws.readyState === 1)),
    })),
  };
}

function broadcast(room, msg) {
  send(room.host, msg);
  for (const p of room.players) if (p.ws) send(p.ws, msg);
}

const GONE_MS = Number(process.env.GONE_MS) || 30 * 1000;       // a turn belonging to a dropped phone is skipped after this
const HOST_GRACE_MS = 10 * 60 * 1000; // a room outlives its host screen this long

function clearHostGrace(room) {
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  room.hostGraceTimer = null;
}

function closeRoom(room, reason) {
  broadcast(room, { type: 'error', error: reason });
  if (room.botTimer) clearTimeout(room.botTimer);
  clearTurn(room);
  clearHostGrace(room);
  rooms.delete(room.code);
  persistRooms();
}

function broadcastAll(room) {
  room.lastSeen = Date.now(); // keeps a long game night from being swept mid-play
  persistRooms();
  broadcast(room, roomSnapshot(room));
  if (room.state) {
    armTurn(room);
    broadcast(room, { type: 'state', state: { ...game.serialize(room.state), gameId: room.gameId, revision: room.revision } });
  }
}

// There is no turn clock: a player takes as long as they like, and ends their
// turn by playing a word or pressing Pass. The only timer is a safety net for
// a disconnected phone; its turn is skipped after GONE_MS. Reconnecting with
// its private credential cancels the timer. Bots are driven by scheduleBots.
function armTurn(room) {
  if (!room.state || room.state.phase !== 'playing') { clearTurn(room); return; }
  const cur = room.state.players[room.state.turn];
  const player = room.players.find((p) => p.color === cur);
  if (!player || player.bot || (player.ws && player.ws.readyState === 1)) { clearTurn(room); return; }
  if (room.armedFor === cur && room.turnTimer) return; // already counting for this turn
  clearTurn(room);
  room.armedFor = cur;
  const disconnected = player.disconnectedAt || Date.now();
  const remaining = Math.max(0, GONE_MS - (Date.now() - disconnected));
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    room.armedFor = null;
    if (!room.state || room.state.phase !== 'playing') return;
    if (room.state.players[room.state.turn] !== cur) return;
    game.passTurn(room.state, cur);
    room.revision++;
    persistRooms();
    broadcast(room, { type: 'skipped', color: cur });
    broadcastAll(room);
    scheduleBots(room);
  }, remaining);
}

function clearTurn(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.armedFor = null;
}

function scheduleBots(room) {
  if (!room.state || room.state.phase !== 'playing') return;
  const current = room.state.players[room.state.turn];
  const player = room.players.find((p) => p.color === current);
  if (!player || !player.bot || room.botTimer) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!room.state || room.state.phase !== 'playing') return;
    if (room.state.players[room.state.turn] !== current) return;
    const move = game.findMove(room.state, current, BOT_WORDS);
    let result;
    if (move) {
      result = game.playWord(room.state, current, move, DICT);
      if (result.ok) {
        room.revision++;
        persistRooms();
        broadcast(room, { type: 'played', color: current, word: move.word, bot: true, gameId: room.gameId, revision: room.revision, actionId: randomUUID(), presentation: result.presentation });
      }
    }
    if (!move || !result.ok) { game.passTurn(room.state, current); room.revision++; }
    broadcastAll(room);
    scheduleBots(room);
  }, room.botDelayMs != null ? room.botDelayMs : 1200);
}

wss.on('connection', (ws, req) => {
  const origin = inviteOrigin(req);
  if (!originAllowed(req.headers.origin, req)) { ws.close(1008, 'Origin not allowed'); return; }
  const ip = clientIp(req);
  if (!limiter.connect(ip, MAX_SOCKETS_PER_IP)) { ws.close(1013, 'Too many connections'); return; }
  ws.once('close', () => limiter.disconnect(ip));
  ws.roomCode = null;
  ws.role = null;
  let windowStart = Date.now(), messages = 0;
  ws.on('error', () => {}); // oversized/malformed frames are closed by ws

  ws.on('message', async (raw) => {
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); messages = 0; }
    if (++messages > 40) { ws.close(1008, 'Too many messages'); return; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const checked = validate.message(parsed);
    if (checked.error) return send(ws, { type: 'error', error: checked.error });
    const msg = checked.msg;
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;

    try {
      switch (msg.type) {
        case 'host_create': {
          if (ws.roomCode) return send(ws, { type: 'error', error: 'Already connected to a room.' });
          // A reopened host screen asks to resume its own room by code. Only
          // honoured while that room has no live host, so a second screen
          // can't hijack a room someone is already hosting.
          const want = msg.resume;
          const existing = want ? rooms.get(want) : null;
          if (existing && !security.matches(msg.token, existing.hostTokenHash)) return send(ws, { type: 'error', code: 'HOST_AUTH', error: 'Host recovery credential required.' });
          if (existing && existing.host && existing.host.readyState === 1) return send(ws, { type: 'error', code: 'HOST_BUSY', error: 'Host is already connected.' });
          if (existing && !(existing.host && existing.host.readyState === 1)) {
            if (existing.hostGoneAt && Date.now() - existing.hostGoneAt >= HOST_GRACE_MS) { closeRoom(existing, 'Host never came back. Room closed.'); return send(ws, { type: 'error', code: 'ROOM_GONE', error: 'Room not found. Check the code.' }); }
            existing.host = ws;
            existing.hostGoneAt = null;
            clearHostGrace(existing);
            ws.roomCode = existing.code;
            ws.role = 'host';
            const resumeUrl = `${origin}/play.html?room=${existing.code}`;
            send(ws, {
              type: 'hosted',
              code: existing.code,
              token: msg.token,
              joinUrl: resumeUrl,
              qr: await QRCode.toDataURL(resumeUrl, { margin: 1, width: 360 }),
            });
            broadcastAll(existing);
            break;
          }
          if (!limiter.hit('host:' + ip, HOST_LIMIT, HOST_WINDOW_MS)) return send(ws, { type: 'error', error: 'Too many rooms created. Wait a minute and try again.' });
          if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', error: 'The server is busy. Try again shortly.' });
          const code = newCode();
          const hostToken = security.token();
          const r = {
            code,
            hostTokenHash: security.hash(hostToken),
            host: ws,
            players: [],
            phase: 'lobby',
            state: null,
            gameId: null,
            revision: 0,
            botTimer: null,
            turnTimer: null,
            hostGraceTimer: null,
            botDelayMs: msg.botDelayMs,
            created: Date.now(),
          };
          rooms.set(code, r);
          persistRooms();
          ws.roomCode = code;
          ws.role = 'host';
          const joinUrl = `${origin}/play.html?room=${code}`;
          const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 });
          send(ws, { type: 'hosted', code, joinUrl, qr, token: hostToken });
          send(ws, roomSnapshot(r));
          break;
        }
        case 'join': {
          const code = msg.code;
          if (limiter.blocked('guess:' + ip, GUESS_LIMIT, GUESS_WINDOW_MS)) return send(ws, { type: 'error', error: 'Too many wrong codes. Wait a minute and try again.' });
          if (ws.role === 'host') return send(ws, { type: 'error', error: 'Open the join link in another tab to play.' });
          if (ws.roomCode && ws.roomCode !== code) return send(ws, { type: 'error', error: 'Already connected to a room.' });
          const r = rooms.get(code);
          if (!r) { limiter.hit('guess:' + ip, GUESS_LIMIT, GUESS_WINDOW_MS); return send(ws, { type: 'error', code: 'ROOM_GONE', error: 'Room not found. Check the code.' }); }
          const name = msg.name;
          const between = r.phase !== 'lobby' && r.state && r.state.phase === 'over';
          const seat = r.players.find(
            (p) => !p.bot && (!p.ws || p.ws.readyState !== 1) && security.matches(msg.token, p.tokenHash)
          );
          if (seat) {
            seat.ws = ws;
            seat.disconnectedAt = null;
            ws.roomCode = code;
            ws.role = 'player';
            ws.color = seat.color;
            send(ws, { type: 'joined', code, color: seat.color, name: seat.name, token: msg.token });
            broadcastAll(r);
            return;
          }
          if (r.phase !== 'lobby' && !between) {
            limiter.hit('guess:' + ip, GUESS_LIMIT, GUESS_WINDOW_MS);
            return send(ws, { type: 'error', code: 'SEAT_GONE', error: 'That game already started.' });
          }
          // One socket holds one seat. Double-tapping Join used to create a
          // second seat sharing the same socket; closing it freed only one and
          // the leftover ghost stalled the game when its turn came round.
          const mine = r.players.find((p) => p.ws === ws);
          if (mine) {
            send(ws, { type: 'joined', code, color: mine.color, name: mine.name });
            return broadcastAll(r);
          }
          // Names are how a dropped phone reclaims its seat, so they have to be
          // unique or the wrong player can take it.
          if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
            return send(ws, { type: 'error', error: `"${name}" is taken — pick another name.` });
          }
          if (r.players.length >= 4) return send(ws, { type: 'error', error: 'Room is full (4 players max).' });
          const color = game.COLORS.find((c) => !r.players.some((p) => p.color === c));
          const seatToken = security.token();
          const player = { ws, name, color, bot: false, tokenHash: security.hash(seatToken) };
          r.players.push(player);
          ws.roomCode = code;
          ws.role = 'player';
          ws.color = color;
          send(ws, { type: 'joined', code, color, name, token: seatToken });
          broadcastAll(r);
          break;
        }
        case 'add_bot': {
          if (!room || ws.role !== 'host') return;
          if (room.phase !== 'lobby' || room.players.length >= 4) return;
          const color = game.COLORS.find((c) => !room.players.some((p) => p.color === c));
          const names = ['Sphinx', 'Giza', 'Rosetta', 'Anubis'];
          room.players.push({ ws: null, name: names[room.players.length % names.length] + ' (AI)', color, bot: true });
          broadcastAll(room);
          break;
        }
        case 'start': {
          if (!room || ws.role !== 'host') return;
          if (room.phase !== 'lobby') return;
          if (room.players.length < 2) return send(ws, { type: 'error', error: 'Need at least 2 players.' });
          room.phase = 'playing';
          room.state = game.createGame(room.players.map((p) => p.color));
          room.gameId = randomUUID(); room.revision = 0;
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'preview': {
          if (!room || ws.role !== 'player' || !room.state) return;
          if (msg.gameId !== room.gameId || msg.revision !== room.revision) return send(ws, { type: 'preview', requestId: msg.requestId, ok: false, error: 'The board changed. Try again.' });
          const result = game.planWord(room.state, ws.color, msg, DICT);
          send(ws, { type: 'preview', requestId: msg.requestId, gameId: room.gameId, revision: room.revision, ...result });
          break;
        }
        case 'play': {
          if (!room || ws.role !== 'player' || !room.state) return;
          if (msg.gameId !== undefined && (msg.gameId !== room.gameId || msg.revision !== room.revision)) return send(ws, { type: 'reject', error: 'The board changed. Try again.' });
          const result = game.playWord(room.state, ws.color, { r: msg.r, c: msg.c, dir: msg.dir, word: msg.word }, DICT);
          if (!result.ok) return send(ws, { type: 'reject', error: result.error });
          // Focus is on spelling, not points — announce the word, not the score
          room.revision++;
          persistRooms();
          broadcast(room, { type: 'played', color: ws.color, word: result.word, gameId: room.gameId, revision: room.revision, actionId: randomUUID(), presentation: result.presentation });
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'pass': {
          if (!room || ws.role !== 'player' || !room.state) return;
          const result = game.passTurn(room.state, ws.color);
          if (!result.ok) return send(ws, { type: 'reject', error: result.error });
          room.revision++;
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'again': {
          if (!room || ws.role !== 'host') return;
          if (!room.state || room.state.phase !== 'over') return;
          clearTurn(room);
          if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
          // Anyone who dropped out during the last game doesn't get a seat in
          // the next one; bots and everyone still connected keep theirs.
          room.players = room.players.filter((p) => p.bot || p.ws);
          if (room.players.length >= 2) {
            // Straight into the next game on the same room code — no second
            // trip through the lobby for the people who are already here.
            room.phase = 'playing';
            room.state = game.createGame(room.players.map((p) => p.color));
            room.gameId = randomUUID(); room.revision = 0;
            broadcastAll(room);
            scheduleBots(room);
          } else {
            // Not enough players left to deal a board — back to the lobby so
            // the host can wait for more phones to join.
            room.phase = 'lobby';
            room.state = null;
            broadcastAll(room);
          }
          break;
        }
      }
    } catch (err) {
      console.error('ws error:', err);
      send(ws, { type: 'error', error: 'Server error.' });
    }
  });

  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;
    if (ws.role === 'host') {
      // The big screen is a display, not the game: closing it must not end the
      // room. A laptop sleeping or a tab being discarded used to kick everyone
      // and delete the game. Hold the room so the host can reopen /host.html
      // and pick the same room back up; play continues meanwhile.
      if (room.host !== ws) return; // a stale socket the host already replaced
      room.host = null;
      room.hostGoneAt = Date.now();
      room.lastSeen = Date.now();
      persistRooms();
      broadcast(room, { type: 'error', error: 'Host screen disconnected — reopen it to carry on.' });
      clearHostGrace(room);
      room.hostGraceTimer = setTimeout(() => closeRoom(room, 'Host never came back. Room closed.'), HOST_GRACE_MS);
    } else {
      const p = room.players.find((x) => x.ws === ws);
      if (p) {
        // Nothing to hold a seat for before the game starts, or once it's
        // finished (someone tapping "Main Menu" on the results screen).
        if (room.phase === 'lobby' || (room.state && room.state.phase === 'over')) {
          room.players = room.players.filter((x) => x !== p);
        } else {
          // Hold the seat: they can rejoin with their private credential (same
          // color, collected pyramids and log). The turn timer keeps
          // the game moving if it's their turn while they're gone.
          p.ws = null;
          p.disconnectedAt = Date.now();
        }
      }
      broadcastAll(room);
    }
  });
});

// Rebuild runtime-only socket/timer fields from the last atomic checkpoint.
// After a restart every human session is considered disconnected; credentials
// stay as hashes and must be presented again to reclaim a seat/host.
const startupNow = Date.now();
const savedRooms = roomSnapshotStore;
for (const saved of savedRooms) {
  const lifecycle = previousLifecycle.get(saved.code) || saved;
  const lastSeen = lifecycle.lastSeen || saved.lastSeen;
  const hostGoneAt = lifecycle.hostGoneAt || saved.hostGoneAt || startupNow;
  if (startupNow - lastSeen > 2 * 60 * 60 * 1000) continue;
  const room = {
    ...saved,
    host: null,
    players: saved.players.map((player) => ({
      ...player,
      ws: null,
      ...(player.bot ? {} : { disconnectedAt: player.disconnectedAt || startupNow }),
    })),
    botTimer: null,
    turnTimer: null,
    hostGraceTimer: null,
    armedFor: null,
    lastSeen,
    hostGoneAt,
  };
  rooms.set(room.code, room);
  if (startupNow - room.hostGoneAt >= HOST_GRACE_MS) { rooms.delete(room.code); continue; }
  const hostDelay = HOST_GRACE_MS - (startupNow - room.hostGoneAt);
  room.hostGraceTimer = setTimeout(() => closeRoom(room, 'Host never came back. Room closed.'), hostDelay);
  armTurn(room);
  scheduleBots(room);
}
// Drop rooms that expired while the process was offline from the checkpoint too.
const resumableCount = savedRooms.filter((saved) => {
  const lifecycle = previousLifecycle.get(saved.code) || saved;
  const lastSeen = lifecycle.lastSeen || saved.lastSeen;
  const hostGoneAt = lifecycle.hostGoneAt || saved.hostGoneAt || startupNow;
  return startupNow - lastSeen <= 2 * 60 * 60 * 1000 && startupNow - hostGoneAt < HOST_GRACE_MS;
}).length;
if (rooms.size !== resumableCount) persistRooms();

// Idle room cleanup (2h)
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - (r.lastSeen || r.created) > 2 * 60 * 60 * 1000) closeRoom(r, 'Room closed after two hours idle.');
  }
  limiter.prune();
}, 10 * 60 * 1000).unref();

process.once('exit', storeLock.release);
process.once('SIGINT', () => { storeLock.release(); process.exit(130); });
process.once('SIGTERM', () => { storeLock.release(); process.exit(143); });

assertConfigured();
server.listen(PORT, () => {
  console.log(`Crossword Pyramids listening on http://localhost:${PORT} (dictionary: ${DICT.size} words)`);
});

module.exports = { server, app, DICT, BOT_WORDS };
