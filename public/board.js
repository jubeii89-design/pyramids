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

// The tie-break staged as drawn pyramids, or '' when the game was won
// outright. Keeps the result from looking arbitrary.
function tieBreakStageHTML(state, nameOf) {
  const tb = state.tieBreak;
  if (!tb || !tb.resolved) return '';
  const draws = tb.among
    .slice()
    .sort((a, b) => tb.drew[b] - tb.drew[a])
    .map((c, i) =>
      `<div class="tb-draw" style="--i:${i}">
        <span class="tb-pyr">${tb.drew[c]}</span>
        <span><span class="chip ${c}"></span>${escapeHTML(nameOf(c))} drew <b>${tb.drew[c]}</b></span>
      </div>`)
    .join('');
  return `<div class="tb-stage"><p class="tiebreak">Tied on score — settled by a draw:</p>
    <div class="tb-draws">${draws}</div></div>`;
}

// The end-game reveal, shared by host and phone: winner line first (screens
// and tests read it at the top), then the draw stage if the game was tied,
// then one row per player spelling out captured − own colour left on board
// = final, then the recap. All of it is in the DOM at once; any staging is
// CSS-delayed visibility plus the count-up below, never late insertion.
function finalsRevealHTML(state, nameOf, opts = {}) {
  const f = state.finalScores;
  const pen = state.penalties || {};
  const cap = state.scores || {};
  const rows = rankFinal(state).map((c, i) => {
    const p = pen[c] != null ? pen[c] : (cap[c] || 0) - f[c]; // old saved games lack penalties
    const mine = opts.me === c;
    return `<div class="score rv-row${mine ? ' mine' : ''}" style="--i:${i}">
      <span><span class="chip ${c}"></span>${escapeHTML(nameOf(c))}${mine ? ' <small>(you)</small>' : ''}</span>
      <span class="rv-math"><b class="rv-cap" data-n="${cap[c] || 0}">${cap[c] || 0}</b><i>&minus;</i><b class="rv-pen" data-n="${p}">${p}</b><i>=</i></span>
      <b class="rv-final" data-n="${f[c]}">${f[c]}</b></div>`;
  }).join('');
  return `<p class="rv-winner">&#127942; <b>${escapeHTML(nameOf(state.winner))}</b> wins!</p>` +
    tieBreakStageHTML(state, nameOf) + rows +
    `<p class="rv-key">captured &minus; your colour left on board = final</p>` +
    gameRecapHTML(state, nameOf);
}

// Count the reveal's numbers up from 0, staggered with the CSS row delays.
// Skipped under prefers-reduced-motion: the DOM already holds the finals.
function animateFinalsReveal(el) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.add('rv-anim');
  el.querySelectorAll('.rv-row').forEach((row, i) => {
    row.querySelectorAll('[data-n]').forEach((b) => {
      const target = parseInt(b.dataset.n, 10) || 0;
      const t0 = performance.now() + 350 * i; // matches the CSS row delay
      const dur = 800;
      (function tick(now) {
        const k = Math.min(1, Math.max(0, (now - t0) / dur));
        b.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
      })(performance.now());
    });
  });
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
  ['Your turn', 'Tap letters on the board in the order you want to spell them. Each tile shows its letter in the middle, its point value in the top-left corner and how many are stacked there (5×, 4× …) in the bottom-right. Tap the square beside the black letter to choose Across or Down (Across if you do not), then press Submit. There is no clock: take as long as you like, or press Pass.'],
  ['Every word needs', 'At least one black letter (a black house pyramid or a printed square), at least one pyramid of your own colour, and at least one pyramid that moves. The black letter stays where it is, so it decides where your word sits on the board.'],
  ['Undoing', 'Tap a letter in your word to take it out, or press Clear to start again. A refused word stays in your word line with the reason shown — fix it, or press Clear.'],
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
  if (top.o === 'hidden') {
    return `<div class="tile o-hidden" data-owner="hidden"><b class="L">?</b><i class="n">${depth}&times;</i></div>`;
  }
  return `<div class="tile o-${top.o}" data-owner="${top.o}" data-letter="${top.l}" data-value="${top.v}">
    <b class="L">${top.l.toUpperCase()}</b><i class="v">${top.v}</i><i class="n">${depth}&times;</i>
  </div>`;
}

// What a screen reader says about one square. The owner key ('yellow') is a
// word the game shows nowhere else — the Gold player is "Gold" on every screen
// and in the tracker — so a raw key here is the one place a listener would hear
// a colour the game does not use. `names` is opts.names, key -> player name.
// "Row N, column N" stays the opening: it is the only way a listener can tell
// which square is being described.
function cellLabel(cell, r, c, names) {
  const where = `Row ${r + 1}, column ${c + 1}: `;
  if (!cell.t) return where + (cell.p ? `printed letter ${cell.p.toUpperCase()}` : 'empty');
  // A covered piece (another player's lifted stack) has no letter or owner to
  // read out — tileHTML shows it as a bare "?" — so don't invent one.
  if (cell.t.o === 'hidden') return where + `a covered pyramid, stack of ${cell.n}`;
  const who = (names && names[cell.t.o]) || COLOR_NAMES[cell.t.o] || cell.t.o;
  const stack = cell.n > 1 ? `${who}'s stack of ${cell.n}` : `${who}'s pyramid`;
  return where + `${cell.t.l.toUpperCase()}, value ${cell.t.v}, ${stack}`;
}

// Arrow-key moves for the board's roving tabindex, as [dr, dc].
const CELL_STEP = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
// Which square currently holds the board's single tabindex="0", or null for the
// derived default. Only an arrow key sets it, and focus leaving the board
// clears it: #board's innerHTML is captured and compared byte for byte after a
// Clear, so a tab stop that remembered where the user had been would make two
// identical game states serialize differently.
let roved = null;

// state.cells[r][c] = { p: printedLetter|null, n: stackDepth, t: {l,v,o}|null }
// Keyed renderer: the size*size cell nodes are created once per board element
// and reused for every render. A cell's content is rebuilt only when its
// pieces actually changed (a per-cell signature); decorations (selection,
// glow, arrows) are cheap class toggles recomputed every time. Stable nodes
// are what lets a played word be animated on top of the board.
function renderBoard(el, state, opts = {}) {
  el.dataset.focus = opts.focus || '';
  const size = state.size;
  if (el.childElementCount !== size * size) {
    el.replaceChildren();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r; div.dataset.c = c;
        el.appendChild(div);
      }
    }
    // One delegated listener for the whole board; the current handler is
    // swapped on every render instead of re-binding 100 listeners.
    const fire = (target) => {
      const cell = target && target.closest && target.closest('.cell');
      if (!cell || cell.parentElement !== el || !el._onCell) return;
      el._onCell(+cell.dataset.r, +cell.dataset.c);
    };
    el.addEventListener('click', (e) => fire(e.target));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.classList && e.target.classList.contains('cell')) { e.preventDefault(); fire(e.target); }
        return;
      }
      // The board is one tab stop, so the arrows are the only way to reach the
      // other 99 squares. They move focus and the stop together, and never
      // re-render: a render would rebuild nothing but would cost the keyboard
      // user their place if the derived stop disagreed.
      const step = CELL_STEP[e.key];
      if (!step && e.key !== 'Home' && e.key !== 'End') return;
      if (!el._onCell) return; // a non-interactive board has no tab stop at all
      const from = e.target;
      if (!from.classList || !from.classList.contains('cell') || from.parentElement !== el) return;
      e.preventDefault(); // otherwise the arrows scroll the page out from under the board
      const clamp = (v) => Math.max(0, Math.min(size - 1, v));
      const r = +from.dataset.r, c = +from.dataset.c;
      const nr = step ? clamp(r + step[0]) : r; // clamped, not wrapped: the edge is the edge
      const nc = step ? clamp(c + step[1]) : (e.key === 'Home' ? 0 : size - 1);
      const next = el.children[nr * size + nc];
      if (!next) return;
      roved = { r: nr, c: nc };
      from.setAttribute('tabindex', '-1');
      next.setAttribute('tabindex', '0');
      next.focus();
    });
    // Once focus is off the board entirely, the stop goes back to the derived
    // one. relatedTarget is the element taking focus, so a move between two
    // cells (which is what .focus() above causes) must not clear it.
    el.addEventListener('focusout', (e) => {
      if (!e.relatedTarget || !el.contains(e.relatedTarget)) roved = null;
    });
  }
  el._onCell = opts.onCell || null;
  const interactive = !!opts.onCell;
  // Exactly one square carries tabindex="0", so the board costs a keyboard user
  // one Tab press to pass, not a hundred. The stop is derived from the state on
  // every render — the selected square, else wherever the arrows last left the
  // user, else the first square with something on it. The fallback is
  // deliberately not (0,0): that corner is a runway square, empty on the
  // opening board, and onCell answers an empty square with "That square is
  // empty." — a dead end as the first thing a keyboard user lands on.
  let stop = null;
  if (interactive) {
    const onBoard = (p) => !!p && p.r >= 0 && p.r < size && p.c >= 0 && p.c < size;
    if (onBoard(opts.selected)) stop = { r: opts.selected.r, c: opts.selected.c };
    else if (onBoard(roved)) stop = roved;
    for (let r = 0; !stop && r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = state.cells[r][c];
        if (cell.t || cell.p) { stop = { r, c }; break; }
      }
    }
    if (!stop) stop = { r: 0, c: 0 }; // only reachable on a board with nothing on it
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.cells[r][c];
      const div = el.children[r * size + c];
      const sig = `${cell.p || ''}|${cell.n}|${cell.t ? cell.t.id + ':' + cell.t.l + ':' + cell.t.v + ':' + cell.t.o : ''}`;
      if (div.dataset.sig !== sig) {
        div.dataset.sig = sig;
        div.innerHTML = cell.t
          ? tileHTML(cell.t, cell.n)
          : cell.p ? `<span class="printed-letter">${cell.p.toUpperCase()}</span>` : '';
      }
      // The label lives outside the sig branch because the sig holds no owner
      // NAME: inside, a cell would keep whatever `names` held when its pieces
      // last changed, and on the phone that is the empty map from before the
      // `room` message for the ~90 cells that never change again. Writing it
      // only on a change keeps #board's innerHTML snapshot stable — setAttribute
      // on an attribute that already exists keeps its position in the list,
      // while removeAttribute would re-append it at the end.
      const label = cellLabel(cell, r, c, opts.names);
      if (div.getAttribute('aria-label') !== label) div.setAttribute('aria-label', label);
      const runway = r === 0 || r === size - 1 || c === 0 || c === size - 1;
      div.classList.toggle('runway', runway && !cell.t && !cell.p);
      if (interactive) { div.setAttribute('role', 'button'); div.setAttribute('tabindex', stop.r === r && stop.c === c ? '0' : '-1'); }
      else { div.removeAttribute('role'); div.removeAttribute('tabindex'); }
      // Decorations are recomputed from scratch on every render.
      div.classList.remove('sel', 'cand', 'path-hint', 'dir-hint', 'glow', 'glow-start', 'glow-match');
      delete div.dataset.arrow;
      const oldGhost = div.querySelector('.ghost-letter');
      if (oldGhost) oldGhost.remove();
      if (opts.selected && opts.selected.r === r && opts.selected.c === c) div.classList.add('sel');
      if (opts.candidates && opts.candidates.some(([cr, cc]) => cr === r && cc === c)) div.classList.add('cand');
      if (opts.hintCells && opts.hintCells.some(([hr, hc]) => hr === r && hc === c)) div.classList.add('path-hint');
      if (opts.arrows) {
        const a = opts.arrows.find((x) => x.r === r && x.c === c);
        if (a) { div.classList.add('dir-hint'); div.dataset.arrow = a.glyph; }
      }
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

// Live draft (another player's tentative word) -> board view options.
function draftOpts(state, draft) {
  const items = (draft && draft.items) || [];
  const cells = state.cells.map((row) => row.slice());
  for (const { r, c } of (draft && draft.lifted) || []) {
    const cell = cells[r] && cells[r][c];
    if (!cell || !cell.t) continue;
    const n = cell.n - 1;
    cells[r][c] = n > 0
      ? { ...cell, n, t: { id: cell.t.id, l: '?', v: 0, o: 'hidden' } }
      : { ...cell, n: 0, t: null };
  }
  const viewState = { ...state, cells };
  let spelling = null;
  const start = draft && draft.start;
  if (start && items.length) {
    const down = draft.dir === 'V';
    const path = items.map((_, i) => [start.r + (down ? i : 0), start.c + (down ? 0 : i)]);
    spelling = { path, word: items.map((i) => i.l).join('') };
  }
  const firstBlack = items.find((i) => i.b);
  return {
    state: viewState,
    spelling,
    selected: firstBlack ? { r: firstBlack.r, c: firstBlack.c } : null,
    hintCells: start ? [] : items.map((i) => [i.r, i.c]),
  };
}

// Read-only "NAME is spelling CAT, across" line with letter chips.
function renderDraftLine(el, draft, name) {
  if (!el) return;
  const items = (draft && draft.items) || [];
  if (!items.length) { el.innerHTML = ''; return; }
  const chips = items.map((i) => `<span class="dchip${i.b ? ' dchip-black' : ''}">${escapeHTML(String(i.l || '').toUpperCase())}</span>`).join('');
  el.innerHTML = `<span class="dtext">${escapeHTML(name || 'Player')} is spelling</span> ${chips}` +
    `<span class="dtext">, ${draft.dir === 'V' ? 'down' : 'across'}</span>`;
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

// Every word played so far, grouped under the player who spelled it. Passes
// show too — they move the game towards its stalemate ending, so hiding them
// made that ending arrive "out of nowhere".
function renderWords(el, state, names = {}) {
  const by = {};
  for (const e of state.log || []) (by[e.color] = by[e.color] || []).push(e.pass ? null : e.word);
  el.innerHTML = state.players.map((c) => {
    const entries = by[c] || [];
    const chips = entries.map((w) => (w ? `<b>${escapeHTML(w.toUpperCase())}</b>` : '<i>pass</i>')).join(' ');
    return `<div class="wp-row${state.current === c && state.phase === 'playing' ? ' wp-turn' : ''}">
      <span class="wp-who"><span class="chip ${c}"></span>${escapeHTML(names[c] || COLOR_NAMES[c])}</span>
      <span class="wp-words">${entries.length ? chips : '<i>no words yet</i>'}</span>
    </div>`;
  }).join('');
}

// ---- Play animation (TV): a decorative overlay. The real board has already
// rendered the new state; this replays the move on top of it, so skipping or
// missing it can never desync anything.
//   anim = { steps, fromRects: pieceId -> DOMRect captured BEFORE the new
//            render, size }   opts = { sweepTo: element the captures fly to }
// Remove every in-flight tile at once (a new play starts, or the game ends).
function clearFlyers() {
  document.querySelectorAll('.fly').forEach((f) => f.remove());
}

function animatePlay(boardEl, anim, opts = {}) {
  window.__anims = (window.__anims || 0) + 1; // tests assert the show ran
  clearFlyers(); // rapid back-to-back plays must not stack their flights
  const steps = anim.steps || [];
  const size = anim.size || 10;
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cellAt = (r, c) => boardEl.children[r * size + c] || null;
  const pulse = (r, c, delay) => {
    const div = cellAt(r, c);
    if (!div) return;
    setTimeout(() => { div.classList.add('land'); setTimeout(() => div.classList.remove('land'), 520); }, delay);
  };
  let t = 0;
  const flyers = [];
  for (const s of steps) {
    const [tr, tc] = s.to;
    if (s.kind === 'move' && !reduced) {
      const from = anim.fromRects && anim.fromRects[s.pieceId];
      const toDiv = cellAt(tr, tc);
      const to = toDiv && toDiv.getBoundingClientRect();
      if (from && to && from.width) {
        const fl = document.createElement('div');
        fl.className = 'fly o-' + (s.owner || 'house');
        fl.textContent = String(s.letter || '').toUpperCase();
        fl.style.left = from.left + 'px';
        fl.style.top = from.top + 'px';
        fl.style.width = from.width + 'px';
        fl.style.height = from.height + 'px';
        fl.style.fontSize = Math.max(12, from.height * 0.5) + 'px';
        document.body.appendChild(fl);
        flyers.push(fl);
        const dx = to.left - from.left, dy = to.top - from.top;
        const delay = 30 + t;
        setTimeout(() => { fl.style.transform = `translate(${dx}px, ${dy}px)`; }, delay);
      }
    }
    pulse(tr, tc, reduced ? 0 : 430 + t);
    t += 80;
  }
  // Then the captured pieces sweep off toward the capture pile.
  const target = opts.sweepTo && opts.sweepTo.getBoundingClientRect ? opts.sweepTo.getBoundingClientRect() : null;
  setTimeout(() => {
    for (const fl of flyers) {
      if (target) {
        const r0 = fl.getBoundingClientRect();
        fl.style.transition = 'transform .45s ease-in, opacity .45s ease-in';
        fl.style.transform += ` translate(${target.left - r0.left}px, ${target.top - r0.top}px) scale(.2)`;
      }
      fl.style.opacity = '0';
    }
    setTimeout(() => { for (const fl of flyers) fl.remove(); }, 520);
  }, reduced ? 0 : 520 + t);
}

// A toast is a bare div that appears and vanishes, so a screen reader never
// heard a refusal or "You spelled CAT!" at all. One live region, created on
// first use and reused, carries the same text to the accessibility tree. It has
// to be in the tree to be read, so it is clipped to a pixel rather than hidden:
// display:none and visibility:hidden would take it out and nothing would speak.
let srlive = null;
function announce(text) {
  if (!srlive) {
    srlive = document.createElement('div');
    srlive.id = 'srlive';
    srlive.className = 'srlive';
    srlive.setAttribute('aria-live', 'polite');
    srlive.setAttribute('aria-atomic', 'true');
    srlive.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    document.body.appendChild(srlive);
  }
  // Writing the same string twice is not a change, so screen readers say
  // nothing the second time and a repeated refusal — exactly the case a blind
  // player needs — would be silent. Blanking first makes it a change again.
  // Synchronously: the UI suite reads textContent straight after the action.
  if (srlive.textContent === text) srlive.textContent = '';
  srlive.textContent = text;
}

function toast(text, good, quiet) {
  const t = document.createElement('div');
  t.className = 'toast' + (good ? ' good' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
  if (!quiet) announce(text); // `quiet` is for callers that announce richer text themselves
}
