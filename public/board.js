// Shared flat board renderer + ws helper for host and player screens
'use strict';

// Names are plain text even when interpolated into an HTML template.
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function connectWS(onMessage, onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onopen = () => onOpen && onOpen(ws);
  return ws;
}

function sendWS(ws, msg) { ws.send(JSON.stringify(msg)); }

// Free hosting plans spin a service down after ~15 minutes with no HTTP
// requests, and an open WebSocket doesn't always count as traffic. A ping
// every 10 minutes keeps the server up for as long as a game screen is open,
// so a lobby waiting for players — or a slow round — never goes to sleep.
// Rank for the results screen: the winner is whoever the server says it is,
// even when a tie was settled by a draw. Sorting on score alone would put a
// tied runner-up above the actual winner.
function rankFinal(state) {
  const f = state.finalScores;
  return state.players.slice().sort((a, b) => {
    if (a === state.winner) return -1;
    if (b === state.winner) return 1;
    return f[b] - f[a];
  });
}

// One line explaining a tie that went to a draw, or '' when the game was won
// outright. Keeps the result from looking arbitrary.
function tieBreakLine(state, nameOf) {
  const tb = state.tieBreak;
  if (!tb || !tb.resolved) return '';
  const drew = tb.among
    .slice()
    .sort((a, b) => tb.drew[b] - tb.drew[a])
    .map((c) => `${escapeHTML(nameOf(c))} drew ${tb.drew[c]}`)
    .join(', ');
  return `<p class="tiebreak">Tied on score — settled by a draw: ${drew}.</p>`;
}

// ---- post-game recap, voluntary-support link, and the feedback dialog (shared by host and phone) ----
let publicConfig = {};
fetch('/config.json', { cache: 'no-store' }).then((r) => r.json()).then((c) => { publicConfig = c || {}; }).catch(() => {});

function gameRecapHTML(state, nameOf) {
  const words = (state.log || []).filter((e) => e.word);
  let html = '';
  if (words.length) {
    const best = words.reduce((a, b) => ((b.points || 0) > (a.points || 0) ? b : a));
    const longest = words.reduce((a, b) => (b.word.length > a.word.length ? b : a));
    const counts = {};
    words.forEach((e) => { counts[e.color] = (counts[e.color] || 0) + 1; });
    const busiest = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const row = (label, text) => `<div class="recap-row"><span>${label}</span><b>${text}</b></div>`;
    html += '<div class="recap">' +
      row('Best word', `${escapeHTML(best.word.toUpperCase())} &middot; ${best.points} pts &middot; ${escapeHTML(nameOf(best.color))}`) +
      row('Longest word', `${escapeHTML(longest.word.toUpperCase())} &middot; ${escapeHTML(nameOf(longest.color))}`) +
      row('Most words', `${escapeHTML(nameOf(busiest))} (${counts[busiest]})`) +
      row('Words played', String(words.length)) + '</div>';
  }
  if (publicConfig.tipUrl) {
    html += `<p class="tip"><a href="${escapeHTML(publicConfig.tipUrl)}" target="_blank" rel="noopener noreferrer">&#9829; Enjoying it? Support the game</a></p>`;
  }
  return html;
}

// ---- How to play: a guide any page can open from a [data-howto] button ----
const HOWTO_STEPS = [
  ['The goal', 'Spell words on the board. Every pyramid you collect scores the number on its tip, and your own pyramids still on the board when the game ends cost you their tips. Scores stay hidden until the end.'],
  ['Your turn', 'Tap letters on the board in the order you want to spell them. Each tile shows its letter in the middle, its point value in the top-left corner and how many are stacked there (5×, 4× …) in the bottom-right. Choose Across or Down, then press Submit. There is no clock: take as long as you like, or press Pass.'],
  ['Every word needs', 'At least one black letter (a black house pyramid or a printed square), at least one pyramid of your own colour, and at least one pyramid that moves. The black letter stays where it is, so it decides where your word sits on the board.'],
  ['Undoing', 'Tap a letter in your word to take it out, or press Clear to start again. A refused word sends every letter straight back to the stack it came from.'],
  ['Captured pyramids', 'Every pyramid used in your word is yours. Lifting one uncovers the letter underneath, which you see at once but cannot use this turn. The count in the corner of each stack drops as you lift.'],
  ['How it ends', 'The game ends when any player has no pyramids of their colour left on the board, or after two full rounds of passes. The highest total wins; a tie is settled by a random draw.'],
];
function installHowTo() {
  if (document.getElementById('howto')) return;
  const dlg = document.createElement('dialog');
  dlg.id = 'howto'; dlg.className = 'howto-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const h = document.createElement('h2'); h.className = 'gold'; h.tabIndex = -1; h.textContent = 'How to play';
  const list = document.createElement('ol'); list.className = 'howto-steps';
  for (const [title, body] of HOWTO_STEPS) {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = title;
    const p = document.createElement('p'); p.textContent = body;
    li.append(b, p); list.append(li);
  }
  const close = document.createElement('button');
  close.className = 'btn'; close.value = 'close'; close.textContent = 'Got it';
  form.append(h, list, close);
  dlg.append(form);
  document.body.append(dlg);
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-howto]');
    if (!t) return;
    e.preventDefault();
    try { localStorage.setItem('cp_howto_seen', '1'); } catch {}
    document.querySelectorAll('[data-howto-new]').forEach((n) => n.removeAttribute('data-howto-new'));
    if (typeof dlg.showModal === 'function') { dlg.showModal(); dlg.scrollTop = 0; dlg.querySelector('h2').focus(); } else alert(HOWTO_STEPS.map(([a, b]) => a + ': ' + b).join('\n\n'));
  });
  let seen = false;
  try { seen = localStorage.getItem('cp_howto_seen') === '1'; } catch {}
  if (!seen) document.querySelectorAll('[data-howto]').forEach((n) => n.setAttribute('data-howto-new', ''));
}

// Adds a small Feedback button and dialog. `send` posts a message to the server.
function installFeedback(send) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'fb-btn'; btn.textContent = 'Feedback';
  const dlg = document.createElement('dialog');
  dlg.className = 'fb-dialog';
  dlg.innerHTML = '<form method="dialog"><h3 class="gold">Send feedback</h3>' +
    '<p>What worked, what didn&rsquo;t? It is saved on the game server. Please don&rsquo;t include personal details.</p>' +
    '<textarea maxlength="500" rows="4" aria-label="Your feedback"></textarea>' +
    '<div class="fb-actions"><button value="cancel" class="btn secondary">Cancel</button><button value="send" class="btn">Send</button></div></form>';
  document.body.append(btn, dlg);
  const area = dlg.querySelector('textarea');
  btn.onclick = () => {
    if (typeof dlg.showModal === 'function') { area.value = ''; dlg.showModal(); area.focus(); return; }
    const t = prompt('Your feedback (max 500 characters):');
    if (t && t.trim()) send({ type: 'feedback', text: t.trim().slice(0, 500) });
  };
  dlg.addEventListener('close', () => {
    const text = area.value.trim();
    if (dlg.returnValue === 'send' && text) send({ type: 'feedback', text: text.slice(0, 500) });
  });
}

function keepAwake() {
  setInterval(() => { fetch('/health', { cache: 'no-store' }).catch(() => {}); }, 10 * 60 * 1000);
}

const COLOR_NAMES = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Gold', house: 'House' };
// One stack top, flat: the letter in the centre, its point value in the top-left
// corner and the stack count (5x, 4x ...) in the bottom-right corner.
function tileHTML(top, depth) {
  return `<div class="tile o-${top.o}" data-owner="${top.o}" data-letter="${top.l}" data-value="${top.v}">
    <b class="L">${top.l.toUpperCase()}</b><i class="v">${top.v}</i><i class="n">${depth}&times;</i>
  </div>`;
}

// state.cells[r][c] = { p: printedLetter|null, n: stackDepth, t: {l,v,o}|null }
function renderBoard(el, state, opts = {}) {
  el.dataset.focus = opts.focus || '';
  el.innerHTML = '';
  const size = state.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.cells[r][c];
      const div = document.createElement(opts.onCell ? 'button' : 'div');
      div.className = 'cell';
      div.setAttribute('aria-label', `Row ${r+1}, column ${c+1}: ${cell.t ? cell.t.l.toUpperCase()+' value '+cell.t.v+' '+cell.t.o+' stack '+cell.n : cell.p || 'empty'}`);
      const runway = r === 0 || r === size - 1 || c === 0 || c === size - 1;
      if (runway && !cell.t && !cell.p) div.classList.add('runway');
      if (cell.t) {
        div.innerHTML = tileHTML(cell.t, cell.n);
      } else if (cell.p) {
        div.innerHTML = `<span class="printed-letter">${cell.p.toUpperCase()}</span>`;
      }
      if (opts.selected && opts.selected.r === r && opts.selected.c === c) div.classList.add('sel');
      if (opts.candidates && opts.candidates.some(([cr, cc]) => cr === r && cc === c)) div.classList.add('cand');
      if (opts.hintCells && opts.hintCells.some(([hr, hc]) => hr === r && hc === c)) div.classList.add('path-hint');
      if (opts.onCell) div.addEventListener('click', () => opts.onCell(r, c));
      el.appendChild(div);
    }
  }

  // Spelling preview: glow the path and show the letters being spelled filling
  // into each square. The start square gets a stronger ring; squares whose
  // letter must be stolen/moved in show a "ghost" incoming letter.
  if (opts.spelling && opts.spelling.path) {
    const { path, word } = opts.spelling;
    path.forEach(([r, c], i) => {
      const div = el.children[r * size + c];
      if (!div) return;
      div.classList.add('glow');
      if (i === 0) div.classList.add('glow-start');
      const ch = (word[i] || '').toUpperCase();
      if (!ch) return;
      const cell = state.cells[r][c];
      const here = cell.t ? cell.t.l.toUpperCase() : (cell.p ? cell.p.toUpperCase() : null);
      if (here === ch) {
        div.classList.add('glow-match'); // already the right letter in place
      } else {
        const ghost = document.createElement('span');
        ghost.className = 'ghost-letter';
        ghost.textContent = ch;
        div.appendChild(ghost);
      }
    });
  }
}

// Pyramid tracker: how many of each color remain on the board (+ house),
// so players always know the state of every stack pool.
function renderTracker(el, state, names = {}) {
  const rem = state.remaining || {};
  const rows = ['red', 'blue', 'green', 'yellow'].map((c) => {
    const seated = state.players.includes(c);
    const who = seated && names[c] ? ` — ${escapeHTML(names[c])}` : '';
    return `<div class="trk ${seated ? '' : 'trk-idle'}">
      <span><span class="chip ${c}"></span>${COLOR_NAMES[c]}${who}</span>
      <span class="trk-bar"><i style="width:${((rem[c] || 0) / 30) * 100}%" class="bar-${c}"></i></span>
      <b>${rem[c] || 0}<small>/30</small></b>
    </div>`;
  });
  rows.push(`<div class="trk">
    <span><span class="chip house"></span>House</span>
    <span class="trk-bar"><i style="width:${((rem.house || 0) / 36) * 100}%" class="bar-house"></i></span>
    <b>${rem.house || 0}<small>/36</small></b>
  </div>`);
  el.innerHTML = rows.join('');
}

// Every word played so far, grouped under the player who spelled it.
function renderWords(el, state, names = {}) {
  const by = {};
  for (const e of state.log || []) if (e.word) (by[e.color] = by[e.color] || []).push(e.word);
  el.innerHTML = state.players.map((c) => {
    const words = by[c] || [];
    return `<div class="wp-row${state.current === c && state.phase === 'playing' ? ' wp-turn' : ''}">
      <span class="wp-who"><span class="chip ${c}"></span>${escapeHTML(names[c] || COLOR_NAMES[c])}</span>
      <span class="wp-words">${words.length ? words.map((w) => `<b>${escapeHTML(w.toUpperCase())}</b>`).join(' ') : '<i>no words yet</i>'}</span>
    </div>`;
  }).join('');
}

function toast(text, good) {
  const t = document.createElement('div');
  t.className = 'toast' + (good ? ' good' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
