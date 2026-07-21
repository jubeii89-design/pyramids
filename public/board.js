// Shared board renderer + ws helper for host and player screens
'use strict';

function connectWS(onMessage, onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onopen = () => onOpen && onOpen(ws);
  return ws;
}

function sendWS(ws, msg) { ws.send(JSON.stringify(msg)); }

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
        div.classList.add('top-' + cell.t.o);
        div.innerHTML = `<span class="letter">${cell.t.l.toUpperCase()}</span>` +
          `<span class="val">${cell.t.v}</span>` +
          (cell.n > 1 ? `<span class="depth">×${cell.n}</span>` : '');
      } else if (cell.p) {
        div.innerHTML = `<span class="letter printed-letter">${cell.p.toUpperCase()}</span>`;
      }
      if (opts.selected && opts.selected.r === r && opts.selected.c === c) div.classList.add('sel');
      if (opts.hintCells && opts.hintCells.some(([hr, hc]) => hr === r && hc === c)) div.classList.add('path-hint');
      if (opts.onCell) div.addEventListener('click', () => opts.onCell(r, c));
      el.appendChild(div);
    }
  }
}

function toast(text, good) {
  const t = document.createElement('div');
  t.className = 'toast' + (good ? ' good' : '');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
