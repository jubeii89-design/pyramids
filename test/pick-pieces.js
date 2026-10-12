'use strict';
// Browser test: choose which piece supplies a letter, on the real 3D board.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const game = require('../server/game');
const root = path.join(__dirname, '..');
const output = path.join(root, 'screenshots', 'pick');
const PORT = 3139;
const base = `http://localhost:${PORT}`;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(PORT), PUBLIC_ORIGIN: '', ROOM_STORE_PATH: path.join(os.tmpdir(), `pyramids-pick-${process.pid}.json`) },
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { proc.stdout.on('data', (d) => String(d).includes('listening') && resolve()); proc.on('exit', reject); });
    browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    const host = await context.newPage();
    await host.goto(base + '/host.html');
    await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
    const code = await host.locator('#code').textContent();
    const phones = [];
    for (const name of ['Ada', 'Turing']) {
      const phone = await context.newPage();
      await phone.setViewportSize({ width: 390, height: 844 });
      await phone.goto(base + '/play.html?room=' + code);
      await phone.fill('#namein', name); await phone.click('#joinBtn');
      await phone.waitForSelector('#waitview:not(.hidden)'); phones.push(phone);
    }
    await host.click('#startBtn');
    await host.waitForFunction(() => typeof state !== 'undefined' && state && state.cells);
    const state = await host.evaluate(() => state);
    const color = state.current;
    const phone = phones[color === 'red' ? 0 : 1];
    await phone.waitForSelector('#board.live-board canvas');
    await phone.waitForFunction(() => boardInstances.get(document.getElementById('board'))?.pieces.size > 0);

    // Rebuild an engine state from the public snapshot (only exposed tops matter to planning).
    const engine = { ...state, cells: state.cells.map((row) => row.map((c) => ({ printed: c.p, stack: c.t ? [...Array(c.n - 1).fill({ l: '?', v: 0, o: 'hidden' }), c.t] : [] }))) };
    const all = fs.readFileSync(path.join(root, 'data', 'words.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
    const dict = new Set(all);
    const words = all.filter((w) => w.length >= 3 && w.length <= 5);
    let found = null;
    for (const word of words) {
      for (const dir of ['H', 'V']) for (let r = 0; r < 10 && !found; r++) for (let c = 0; c < 10 && !found; c++) {
        const plan = game.planWord(engine, color, { r, c, dir, word }, dict);
        if (!plan.ok) continue;
        for (let i = 0; i < word.length && !found; i++) {
          const alts = plan.choices[i].options.slice(1).filter((o) => o.kind === 'move');
          for (const alt of alts) {
            const sources = word.split('').map(() => null); sources[i] = { r: alt.from[0], c: alt.from[1] };
            const ok = game.planWord(engine, color, { r, c, dir, word, sources }, dict);
            if (ok.ok) { found = { r, c, dir, word, idx: i, alt: alt.from, auto: plan.choices[i].options[0].from }; break; }
          }
        }
      }
      if (found) break;
    }
    assert.ok(found, 'a word with a usable alternative piece exists on the opening board');

    const tilePoint = (rc) => phone.evaluate(({ r, c }) => {
      const b = boardInstances.get(document.getElementById('board')); const p = b.tiles[r * 10 + c].position.clone().project(b.camera);
      const rect = b.renderer.domElement.getBoundingClientRect(); return { x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2 };
    }, { r: rc.r ?? rc[0], c: rc.c ?? rc[1] });

    // Start square, direction, word, preview.
    const start = await tilePoint(found);
    await phone.mouse.click(start.x, start.y);
    await phone.click(found.dir === 'H' ? '#dirH' : '#dirV');
    await phone.fill('#wordin', found.word);
    await phone.click('#previewBtn');
    await phone.waitForFunction(() => draft && draft.ok);
    await phone.waitForSelector('#pickrow .pick-chip');
    assert.equal(await phone.locator('#pickrow .pick-chip').count(), found.word.length, 'one chip per letter');
    const autoFrom = await phone.evaluate((i) => draft.presentation.steps[i].from, found.idx);
    assert.deepEqual(autoFrom, found.auto, 'automatic choice is what the engine picks');

    // Choose the letter, see candidates, tap the alternative piece.
    await phone.locator('#pickrow .pick-chip').nth(found.idx).click();
    assert.equal(await phone.evaluate(() => pickIndex !== null), true);
    await phone.evaluate(() => document.getElementById('board').scrollIntoView({ block: 'center' }));
    const altPoint = await tilePoint(found.alt);
    await phone.screenshot({ path: path.join(output, 'candidates.png'), fullPage: true });
    await phone.mouse.click(altPoint.x, altPoint.y);
    await phone.waitForFunction((i) => draft && draft.presentation.steps[i] && picks && picks[i], found.idx);
    const usedFrom = await phone.evaluate((i) => draft.presentation.steps[i].from, found.idx);
    assert.deepEqual(usedFrom, found.alt, 'the chosen piece now supplies the letter');
    assert.equal(await phone.locator('#pickrow .pick-chip.picked').count(), 1);
    await phone.screenshot({ path: path.join(output, 'picked.png'), fullPage: true });

    // Commit, and confirm the chosen piece (not the automatic one) was taken.
    const beforeAlt = state.cells[found.alt[0]][found.alt[1]].n;
    const beforeAuto = state.cells[found.auto[0]][found.auto[1]].n;
    const pickedWord = found.word;
    await phone.click('#playBtn');
    await host.waitForFunction(() => state.revision === 1);
    const after = await host.evaluate(() => state);
    assert.equal(after.cells[found.alt[0]][found.alt[1]].n, beforeAlt - 1, 'chosen piece was captured');
    if (found.auto[0] !== found.alt[0] || found.auto[1] !== found.alt[1]) {
      assert.equal(after.cells[found.auto[0]][found.auto[1]].n, beforeAuto, 'the automatic alternative was left alone');
    }
    assert.ok(pickedWord);
    assert.deepEqual(errors, []);
    console.log(`PASS: chose ${found.word.toUpperCase()} letter ${found.idx + 1} from row ${found.alt[0] + 1}, col ${found.alt[1] + 1} instead of row ${found.auto[0] + 1}, col ${found.auto[1] + 1}.`);
  } finally { await browser?.close(); proc.kill(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
