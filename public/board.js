// Shared 3D board renderer + ws helper for host and player screens
'use strict';

function connectWS(onMessage, onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onopen = () => onOpen && onOpen(ws);
  return ws;
}

function sendWS(ws, msg) { ws.send(JSON.stringify(msg)); }

const COLOR_NAMES = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Gold', house: 'House' };

// Build one 3D pyramid piece: four shaded faces meeting at a peak plate that
// shows the tip value, letter on the front face, stack count chip.
function pyramidHTML(top, depth) {
  const houseCls = top.o === 'house' ? ' house' : '';
  return `<div class="pyr${houseCls}" data-owner="${top.o}">
    <i class="f fn"></i><i class="f fe"></i><i class="f fs"></i><i class="f fw"></i>
    <b class="peak">${top.v}</b>
    <span class="pl ink-${top.o}">${top.l.toUpperCase()}</span>
    ${depth > 1 ? `<span class="cnt">×${depth}</span>` : ''}
  </div>`;
}

// state.cells[r][c] = { p: printedLetter|null, n: stackDepth, t: {l,v,o}|null }
function renderBoard(el, state, opts = {}) {
  el.innerHTML = '';
  const size = state.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.cells[r][c];
      const div = document.createElement('div');
      div.className = 'cell';
      const runway = r === 0 || r === size - 1 || c === 0 || c === size - 1;
      if (runway && !cell.t && !cell.p) div.classList.add('runway');
      if (cell.t) {
        div.innerHTML = pyramidHTML(cell.t, cell.n);
      } else if (cell.p) {
        div.innerHTML = `<span class="printed-letter">${cell.p.toUpperCase()}</span>`;
      }
      if (opts.selected && opts.selected.r === r && opts.selected.c === c) div.classList.add('sel');
      if (opts.hintCells && opts.hintCells.some(([hr, hc]) => hr === r && hc === c)) div.classList.add('path-hint');
      if (opts.onCell) div.addEventListener('click', () => opts.onCell(r, c));
      el.appendChild(div);
    }
  }
}

// Pyramid tracker: how many of each color remain on the board (+ house),
// so players always know the state of every stack pool.
function renderTracker(el, state, names = {}) {
  const rem = state.remaining || {};
  const rows = ['red', 'blue', 'green', 'yellow'].map((c) => {
    const seated = state.players.includes(c);
    const who = seated && names[c] ? ` — ${names[c]}` : '';
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

function toast(text, good) {
  const t = document.createElement('div');
  t.className = 'toast' + (good ? ' good' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
