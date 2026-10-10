'use strict';
// Shape-checks every client message once, so handlers only ever see typed,
// bounded fields. Returns { msg } (normalised) or { error }.
const TYPES = new Set(['host_create', 'join', 'add_bot', 'start', 'play', 'preview', 'pass', 'again']);

function cleanName(value) {
  const name = String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}<>]/gu, '')
    .trim()
    .slice(0, 16)
    .trim();
  return name || 'Player';
}

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

function message(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Bad message.' };
  if (!TYPES.has(raw.type)) return { error: 'Unknown message type.' };
  const msg = { type: raw.type };
  if (raw.token !== undefined) {
    msg.token = str(raw.token, 100);
    if (msg.token === null) return { error: 'Bad credential.' };
  }
  switch (raw.type) {
    case 'host_create': {
      const resume = raw.resume === undefined || raw.resume === '' ? '' : str(raw.resume, 4);
      if (resume === null || (resume && !/^[A-Za-z]{4}$/.test(resume))) return { error: 'Bad room code.' };
      msg.resume = resume.toUpperCase();
      if (typeof raw.botDelayMs === 'number' && raw.botDelayMs >= 0 && raw.botDelayMs <= 10000) msg.botDelayMs = raw.botDelayMs;
      break;
    }
    case 'join': {
      const code = str(raw.code, 8) && raw.code.trim().toUpperCase();
      if (!code || !/^[A-Z]{4}$/.test(code)) return { error: 'Enter the 4-letter room code.' };
      msg.code = code;
      msg.name = cleanName(raw.name);
      break;
    }
    case 'play':
    case 'preview': {
      const r = int(raw.r, 0, 9), c = int(raw.c, 0, 9);
      if (r === null || c === null) return { error: 'Choose a board square.' };
      if (raw.dir !== 'H' && raw.dir !== 'V') return { error: 'Direction must be H or V.' };
      if (typeof raw.word !== 'string' || !/^[A-Za-z]{3,10}$/.test(raw.word.trim())) {
        return { error: 'Words must be 3-10 letters (A-Z only).' };
      }
      msg.r = r; msg.c = c; msg.dir = raw.dir; msg.word = raw.word.trim();
      if (raw.gameId !== undefined) {
        msg.gameId = str(raw.gameId, 64);
        if (msg.gameId === null) return { error: 'Bad game id.' };
      }
      if (raw.revision !== undefined) {
        msg.revision = int(raw.revision, 0, 1e9);
        if (msg.revision === null) return { error: 'Bad revision.' };
      }
      if (raw.requestId !== undefined) {
        if (Number.isSafeInteger(raw.requestId) && raw.requestId >= 0) msg.requestId = raw.requestId;
        else if (typeof raw.requestId === 'string' && raw.requestId.length <= 40) msg.requestId = raw.requestId;
        else return { error: 'Bad request id.' };
      }
      break;
    }
    default: break; // add_bot, start, pass, again carry no fields
  }
  return { msg };
}

module.exports = { message, cleanName };
