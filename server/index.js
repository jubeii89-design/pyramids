'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const game = require('./game');

const PORT = process.env.PORT || 3000;

// Dictionary
const words = fs
  .readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8')
  .split('\n')
  .filter(Boolean);
const DICT = new Set(words);
// Bot vocabulary: short, common-shaped words keep move search fast
const BOT_WORDS = words.filter((w) => w.length >= 3 && w.length <= 6);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map(); // code -> room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

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

const GONE_MS = 30 * 1000;        // a turn belonging to a dropped phone is skipped after this
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
}

function broadcastAll(room) {
  room.lastSeen = Date.now(); // keeps a long game night from being swept mid-play
  broadcast(room, roomSnapshot(room));
  if (room.state) {
    armTurn(room);
    broadcast(room, { type: 'state', state: game.serialize(room.state) });
  }
}

// There is no turn clock: a player takes as long as they like, and ends their
// turn by playing a word or pressing Pass. The only timer is a safety net for
// a phone that has dropped off — its turn is skipped so the room isn't stuck
// waiting on someone who isn't there. Reconnecting cancels it (the join
// broadcast re-arms and finds them connected again); bots are driven by
// scheduleBots and never need one.
function armTurn(room) {
  if (!room.state || room.state.phase !== 'playing') { clearTurn(room); return; }
  const cur = room.state.players[room.state.turn];
  const player = room.players.find((p) => p.color === cur);
  if (!player || player.bot || (player.ws && player.ws.readyState === 1)) { clearTurn(room); return; }
  if (room.armedFor === cur && room.turnTimer) return; // already counting for this turn
  clearTurn(room);
  room.armedFor = cur;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    room.armedFor = null;
    if (!room.state || room.state.phase !== 'playing') return;
    if (room.state.players[room.state.turn] !== cur) return;
    game.passTurn(room.state, cur);
    broadcast(room, { type: 'skipped', color: cur });
    broadcastAll(room);
    scheduleBots(room);
  }, GONE_MS);
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
      if (result.ok) broadcast(room, { type: 'played', color: current, word: move.word, bot: true });
    }
    if (!move || !result.ok) game.passTurn(room.state, current);
    broadcastAll(room);
    scheduleBots(room);
  }, room.botDelayMs != null ? room.botDelayMs : 1200);
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;

    try {
      switch (msg.type) {
        case 'host_create': {
          // A reopened host screen asks to resume its own room by code. Only
          // honoured while that room has no live host, so a second screen
          // can't hijack a room someone is already hosting.
          const want = String(msg.resume || '').toUpperCase().trim();
          const existing = want ? rooms.get(want) : null;
          if (existing && !(existing.host && existing.host.readyState === 1)) {
            existing.host = ws;
            existing.hostGoneAt = null;
            clearHostGrace(existing);
            ws.roomCode = existing.code;
            ws.role = 'host';
            const resumeUrl = `${msg.origin || `http://localhost:${PORT}`}/play.html?room=${existing.code}`;
            send(ws, {
              type: 'hosted',
              code: existing.code,
              joinUrl: resumeUrl,
              qr: await QRCode.toDataURL(resumeUrl, { margin: 1, width: 360 }),
            });
            broadcastAll(existing);
            break;
          }
          const code = newCode();
          const r = {
            code,
            host: ws,
            players: [],
            phase: 'lobby',
            state: null,
            botTimer: null,
            botDelayMs: msg.botDelayMs,
            created: Date.now(),
          };
          rooms.set(code, r);
          ws.roomCode = code;
          ws.role = 'host';
          const origin = msg.origin || `http://localhost:${PORT}`;
          const joinUrl = `${origin}/play.html?room=${code}`;
          const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 });
          send(ws, { type: 'hosted', code, joinUrl, qr });
          send(ws, roomSnapshot(r));
          break;
        }
        case 'join': {
          const code = String(msg.code || '').toUpperCase().trim();
          const r = rooms.get(code);
          if (!r) return send(ws, { type: 'error', error: 'Room not found. Check the code.' });
          const name = String(msg.name || '').trim().slice(0, 16) || 'Player';
          const between = r.phase !== 'lobby' && r.state && r.state.phase === 'over';
          if (r.phase !== 'lobby' && !between) {
            // Mid-game rejoin: reclaim a disconnected seat by name (phones
            // drop websockets when locked/refreshed)
            const seat = r.players.find(
              (p) => !p.bot && (!p.ws || p.ws.readyState !== 1) && p.name.toLowerCase() === name.toLowerCase()
            );
            if (!seat) return send(ws, { type: 'error', error: 'That game already started.' });
            seat.ws = ws;
            seat.disconnectedAt = null;
            ws.roomCode = code;
            ws.role = 'player';
            ws.color = seat.color;
            send(ws, { type: 'joined', code, color: seat.color, name: seat.name });
            broadcastAll(r);
            return;
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
          const player = { ws, name, color, bot: false };
          r.players.push(player);
          ws.roomCode = code;
          ws.role = 'player';
          ws.color = color;
          send(ws, { type: 'joined', code, color, name });
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
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'play': {
          if (!room || ws.role !== 'player' || !room.state) return;
          const result = game.playWord(room.state, ws.color, { r: msg.r, c: msg.c, dir: msg.dir, word: msg.word }, DICT);
          if (!result.ok) return send(ws, { type: 'reject', error: result.error });
          // Focus is on spelling, not points — announce the word, not the score
          broadcast(room, { type: 'played', color: ws.color, word: result.word });
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'pass': {
          if (!room || ws.role !== 'player' || !room.state) return;
          const result = game.passTurn(room.state, ws.color);
          if (!result.ok) return send(ws, { type: 'reject', error: result.error });
          broadcastAll(room);
          scheduleBots(room);
          break;
        }
        case 'again': {
          if (!room || ws.role !== 'host') return;
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
          // Hold the seat: they can rejoin by name (same color, same collected
          // pyramids, same log) within the grace window. The turn timer keeps
          // the game moving if it's their turn while they're gone.
          p.ws = null;
          p.disconnectedAt = Date.now();
        }
      }
      broadcastAll(room);
    }
  });
});

// Idle room cleanup (2h)
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - (r.lastSeen || r.created) > 2 * 60 * 60 * 1000) closeRoom(r, 'Room closed after two hours idle.');
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Crossword Pyramids listening on http://localhost:${PORT} (dictionary: ${DICT.size} words)`);
});

module.exports = { server, app, DICT, BOT_WORDS };
