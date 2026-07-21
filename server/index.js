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
    players: room.players.map((p) => ({ name: p.name, color: p.color, bot: !!p.bot, connected: p.bot || (p.ws && p.ws.readyState === 1) })),
  };
}

function broadcast(room, msg) {
  send(room.host, msg);
  for (const p of room.players) if (p.ws) send(p.ws, msg);
}

function broadcastAll(room) {
  broadcast(room, roomSnapshot(room));
  if (room.state) broadcast(room, { type: 'state', state: game.serialize(room.state) });
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
      if (result.ok) broadcast(room, { type: 'played', color: current, word: move.word, points: result.points, bot: true });
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
          if (r.phase !== 'lobby') {
            // Mid-game rejoin: reclaim a disconnected seat by name (phones
            // drop websockets when locked/refreshed)
            const seat = r.players.find(
              (p) => !p.bot && (!p.ws || p.ws.readyState !== 1) && p.name.toLowerCase() === name.toLowerCase()
            );
            if (!seat) return send(ws, { type: 'error', error: 'That game already started.' });
            seat.ws = ws;
            ws.roomCode = code;
            ws.role = 'player';
            ws.color = seat.color;
            send(ws, { type: 'joined', code, color: seat.color, name: seat.name });
            broadcastAll(r);
            return;
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
          broadcast(room, { type: 'played', color: ws.color, word: result.word, points: result.points });
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
          room.phase = 'lobby';
          room.state = null;
          broadcastAll(room);
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
      broadcast(room, { type: 'error', error: 'Host disconnected. Room closed.' });
      if (room.botTimer) clearTimeout(room.botTimer);
      rooms.delete(room.code);
    } else {
      const p = room.players.find((x) => x.ws === ws);
      if (p) {
        if (room.phase === 'lobby') room.players = room.players.filter((x) => x !== p);
        else p.ws = null; // seat stays during a game; they can't rejoin mid-game (kept simple)
      }
      broadcastAll(room);
    }
  });
});

// Idle room cleanup (2h)
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.created > 2 * 60 * 60 * 1000) {
      if (r.botTimer) clearTimeout(r.botTimer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Crossword Pyramids listening on http://localhost:${PORT} (dictionary: ${DICT.size} words)`);
});

module.exports = { server, app, DICT, BOT_WORDS };
