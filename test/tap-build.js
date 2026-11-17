'use strict';
// Browser test of the tap-to-build flow on a phone:
//   tap letters in spelling order -> stack counts drop and the word line fills,
//   Clear puts every stack back exactly, a refused word does the same with a
//   reason, and a good word is accepted and shows up in the words panel.
// Usage: node test/tap-build.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const game = require('../server/game');
const { scriptedPlayer, publicToEngine, WORDS } = require('./helpers/scripted-player');

const PORT = 3127;
const BASE = `http://localhost:${PORT}`;
const DICT = new Set(fs.readFileSync(path.join(__dirname, '..', 'data', 'words.txt'), 'utf8').split(/\r?\n/).filter(Boolean));

let failures = 0;
function check(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
}

async function main() {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramids-tap-'));
  const proc = spawn('node', ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ROOM_STORE_PATH: path.join(storeDir, 'rooms.json') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('listening') && res());
    setTimeout(() => rej(new Error('server start timeout')), 15000);
  });
  const browser = await chromium.launch({ ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}) });
  const scripted = [];
  try {
    console.log('Tap-to-build on a phone');
    const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host.goto(`${BASE}/host.html`);
    await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
    const code = await host.locator('#code').textContent();
    check(await host.locator('#playtoo').isVisible(), 'host screen offers the host their own seat');
    const playUrl = await host.evaluate(() => hostPlayUrl);
    check(/play\.html\?room=[A-Z]{4}#seat=/.test(playUrl), 'host seat link carries a credential in the fragment');

    // The host sits down from a second page using that link: automatically seated, first colour.
    const hostPhone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    hostPhone.on('pageerror', (e) => console.log('  page error:', e.message));
    host.on('pageerror', (e) => console.log('  host page error:', e.message));
    await hostPhone.goto(playUrl);
    check((await hostPhone.locator('#namein').inputValue()) === 'Host', 'seat link pre-fills the host name');
    check(!(await hostPhone.evaluate(() => location.hash)), 'credential is removed from the address bar');
    await hostPhone.fill('#namein', 'Hana');
    await hostPhone.click('#joinBtn');
    await hostPhone.waitForSelector('#waitview:not(.hidden)');
    check(/red/i.test(await hostPhone.locator('#mycolor').textContent()), 'host is seated as red without joining separately');

    scripted.push(await scriptedPlayer(BASE, code, 'Bot', { hold: true }));
    await host.waitForFunction(() => document.querySelectorAll('#players li').length === 2);
    check((await host.locator('#players').textContent()).includes('Hana'), 'host appears in the lobby under their own name');
    await host.click('#startBtn');
    await hostPhone.waitForSelector('#gameview:not(.hidden)');
    // Whoever the draw picks to go first: if it is the held bot, let it take one turn, then hold it again.
    scripted[0].release();
    await hostPhone.waitForFunction(() => document.getElementById('turnbanner').classList.contains('mine'), { timeout: 20000 });
    scripted[0].pause();

    const ph = hostPhone;
    const snap = () => ph.locator('#board').innerHTML();
    const counts = () => ph.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c) => (c.querySelector('.n') || {}).textContent || ''));
    const clearIfAny = async () => { if (await ph.locator('#clearBtn').isEnabled()) await ph.click('#clearBtn'); };
    const tap = (r, c) => ph.evaluate(([rr, cc]) => document.querySelectorAll('#board .cell')[rr * 10 + cc].click(), [r, c]);

    check((await ph.locator('#board .tile').count()) >= 45, 'flat tiles are on the board');
    const first = ph.locator('#board .tile').first();
    check(/^[A-Z]$/.test(await first.locator('.L').textContent()), 'tile shows its letter in the centre');
    check(/^[1-9]$/.test(await first.locator('.v').textContent()), 'tile shows its point value in a corner');
    check(/^\d+×$/.test(await first.locator('.n').textContent()), 'tile shows its stack count in the opposite corner');
    check((await ph.locator('canvas').count()) === 0, 'no 3D canvas anywhere');
    check((await ph.locator('#viewbar, #viewBtn, #rotBtn').count()) === 0, 'no 3D view controls');

    // Touch targets, measured in the browser, not computed: every control a
    // thumb hits clears 44x44. The board grid cannot - 10 cells across a 390px
    // phone is 32px wide by arithmetic - so cells are held to the WCAG 2.2
    // SC 2.5.8 AA floor of 24px, with pinch-zoom as the magnifier (M4-01).
    const tapOk = async (sel, label) => {
      // Guard the count first: boundingBox() on a locator that matches nothing
      // waits the full 30s timeout and then throws, turning a soft check
      // failure into a hard abort of the whole suite.
      const b = (await ph.locator(sel).count()) ? await ph.locator(sel).first().boundingBox() : null;
      check(!!b && b.width >= 44 && b.height >= 44,
        `${label} is at least 44x44 (${b ? Math.round(b.width) + 'x' + Math.round(b.height) : 'not rendered'})`);
    };
    // Scoped to #gameview: the lobby copy of the toggle is inside the hidden
    // #waitview, and boundingBox() on a display:none element is null.
    await tapOk('#gameview [data-sound-toggle]', 'the in-game sound toggle');
    await tapOk('#howtoBtn', 'the how-to button');
    await tapOk('#clearBtn', 'Clear');
    await tapOk('#playBtn', 'Submit');
    await tapOk('#passBtn', 'Pass');
    await tapOk('.fb-btn', 'the feedback button');
    const cellBox = (await ph.locator('#board .cell').count()) ? await ph.locator('#board .cell').first().boundingBox() : null;
    check(!!cellBox && Math.min(cellBox.width, cellBox.height) >= 24,
      `board cells clear the 24px AA floor (${cellBox ? cellBox.width.toFixed(1) + 'x' + cellBox.height.toFixed(1) : 'not rendered'}; height is the binding dimension)`);
    const fbBox = await ph.locator('.fb-btn').boundingBox();
    const bdBox = await ph.locator('#board').boundingBox();
    check(!(fbBox.x < bdBox.x + bdBox.width && fbBox.x + fbBox.width > bdBox.x
          && fbBox.y < bdBox.y + bdBox.height && fbBox.y + fbBox.height > bdBox.y),
      'the feedback button does not sit on top of the board');

    // The same owner shapes on the phone, at 32px cells.
    const phoneMarks = await ph.evaluate(() => {
      const out = {};
      for (const t of document.querySelectorAll('#board .tile[data-owner]')) out[t.dataset.owner] = getComputedStyle(t, '::after').content;
      return out;
    });
    const phOwners = Object.keys(phoneMarks).filter((o) => o !== 'house' && o !== 'hidden');
    check(phOwners.length >= 2 && phOwners.every((o) => /^".+"$/.test(phoneMarks[o])),
      `tiles carry an owner shape on the phone too (${phOwners.map((o) => o + phoneMarks[o]).join(' ')})`);
    check(/^"/.test(await ph.evaluate(() => getComputedStyle(document.querySelector('.chip'), '::after').content)),
      'the lobby colour swatch carries the shape too, so players learn it');
    check(await ph.locator('#wordspanel').isVisible(), 'words panel is on the phone');

    // A legal word the engine can see: its letters and where each comes from.
    const pub = await ph.evaluate(() => JSON.parse(JSON.stringify(state)));
    const engine = publicToEngine(pub);
    const color = await ph.evaluate(() => myColor);
    const move = game.findMove(engine, color, WORDS.filter((w) => w.length <= 5));
    check(!!move, `found a legal word (${move && move.word})`);
    const plan = game.planWord(engine, color, move, DICT);
    check(plan.ok, 'engine accepts that word');
    const steps = plan.presentation.steps;
    const cellFor = (i) => {
      const s = steps[i];
      const [tr, tc] = s.to;
      return s.kind === 'move' ? s.from : [tr, tc];
    };
    const cells = move.word.split('').map((_, i) => cellFor(i));
    const isBlack = (r, c) => ph.evaluate(([rr, cc]) => blackAt(state.cells[rr][cc]), [r, c]);
    let ai = -1;
    for (let i = 0; i < cells.length && ai < 0; i++) if (await isBlack(...cells[i])) ai = i;
    // The neighbour of the first black letter on the word's axis (right/below, else left/above).
    const [ar, ac] = cells[ai];
    const nbStep = move.dir === 'H' ? [0, 1] : [1, 0];
    let nb = [ar + nbStep[0], ac + nbStep[1]];
    if (nb[0] > 9 || nb[1] > 9) nb = [ar - nbStep[0], ac - nbStep[1]];
    // Letters in order through the black one, one tap on its neighbour for the direction, then the rest.
    // A neighbour that is also one of the letters is simply tapped again where it belongs.
    // A server broadcast arriving mid-build re-renders the phone and can reset
    // the half-built word (the board-changed guard), so on a slow runner the
    // word line ends up short. Build, verify, and start over if disturbed.
    const tapWord = async ({ noDir = false } = {}) => {
      // A square that sits BESIDE the black anchor has its first tap consumed
      // as a direction tap, so the letter needs a second one. Evidence: SCRIP
      // lost its 'i' from (1,2), directly above the black 'r' at (2,2),
      // identically on all 5 attempts - deterministic, so retrying the whole
      // word could never have helped. Verify each tap landed instead.
      const tapLetter = async (rc) => {
        const before = await ph.evaluate(() => currentWord().length);
        await tap(...rc); await ph.waitForTimeout(60);
        if ((await ph.evaluate(() => currentWord().length)) === before) {
          await tap(...rc); await ph.waitForTimeout(60);
        }
      };
      const got = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        for (let i = 0; i <= ai; i++) await tapLetter(cells[i]);
        if (!noDir) { await tap(...nb); await ph.waitForTimeout(60); }
        for (let i = ai + 1; i < cells.length; i++) await tapLetter(cells[i]);
        await ph.waitForTimeout(150);
        const w = await ph.evaluate(() => currentWord());
        if (w === move.word) return true;
        got.push(w || '(empty)');
        await clearIfAny();
      }
      // Give up LOUDLY, and dump the geometry. A bare red here cost a whole
      // debugging session once: the same wrong word came back all 5 times, so
      // it was never a race, and no retry count could ever have fixed it.
      check(false, `tapWord could not build ${move.word.toUpperCase()} in 5 attempts (got ${got.join(', ')})`);
      const seen = await ph.evaluate((cs) => cs.map(([r, c]) => {
        const cell = state.cells[r][c];
        return `${r},${c}=${cell.t ? cell.t.l + (cell.n > 1 ? '(stack ' + cell.n + ')' : '') : cell.p ? cell.p + '(printed)' : 'empty'}`;
      }), cells);
      console.log(`      [diag] word ${move.word} dir ${move.dir} | black index ${ai} | direction tap ${nb[0]},${nb[1]}`);
      console.log(`      [diag] tap cells: ${seen.join('  ')}`);
      console.log(`      [diag] distinct cells: ${new Set(cells.map((c) => c.join(','))).size} of ${cells.length}`);
      return false;
    };
    const hostCounts = () => host.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c) => (c.querySelector('.n') || {}).textContent || ''));
    const hostLetters = () => host.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c) => (c.querySelector('.L') || {}).textContent || ''));
    // 15s, not 5: the draft relay is rate-limited and a loaded CI runner can
    // sit behind that window before the host sees the glow. It is NOT cover for
    // a dropped draft - that loss was permanent, and no timeout ever helped.
    const hostGlowIs = async (n) => {
      const ok = await host.waitForFunction((k) => document.querySelectorAll('#board .cell.glow').length === k, n, { timeout: 15000 }).then(() => true, () => false);
      if (!ok) {
        // Say WHY, so this never has to be re-diagnosed from a bare red check.
        // A stale NON-ZERO host count means the server dropped the last draft
        // and sent nothing after it, so the TV keeps whatever it last received.
        // The 50ms burst throttle that used to do exactly that is gone (see the
        // 'draft' case in server/index.js); only the per-IP limiter can still
        // drop one, and 200/10s is about two concurrent games behind one
        // address, so a venue on one WiFi is the case to suspect here.
        const got = await host.evaluate(() => document.querySelectorAll('#board .cell.glow').length);
        const mine = await ph.evaluate(() => document.querySelectorAll('#board .cell.glow').length);
        console.log(`      [diag] wanted ${n} glows, host has ${got}, phone has ${mine} - ${got !== 0 && got !== n ? 'STALE host mirror (dropped final draft)' : 'host never received the draft'}`);
      }
      return ok;
    };

    check((await ph.locator('#dirH, #dirV, .dirbtn').count()) === 0, 'no Across/Down buttons on the phone');

    // Direction by tapping beside the black letter
    {
      for (let i = 0; i <= ai; i++) { await tap(...cells[i]); await ph.waitForTimeout(60); }
      await ph.waitForTimeout(150);
      const nChips = await ph.locator('#wordline .wchip').count();
      check(nChips === ai + 1, 'letters up to the black one are in the word line');
      check((await ph.locator('#board .cell.dir-hint').count()) >= 2, 'arrows appear beside the black letter');
      await tap(...nb); await ph.waitForTimeout(150);
      check((await ph.locator('#wordline .wchip').count()) === nChips, 'tapping a neighbour sets the direction without adding a letter');
      const arrowsAfter = await ph.locator('#board .cell.dir-hint').count();
      check(arrowsAfter >= 1 && arrowsAfter <= 2, `only the chosen axis stays arrowed (${arrowsAfter})`);
      const nbInWord = cells.slice(0, ai + 1).some(([r, c]) => r === nb[0] && c === nb[1]);
      const nbEmpty = await ph.evaluate(([r, c]) => { const x = state.cells[r][c]; return !x.t && !x.p; }, nb);
      if (!nbInWord && !nbEmpty) {
        await tap(...nb); await ph.waitForTimeout(150);
        check((await ph.locator('#wordline .wchip').count()) === nChips + 1, 'a second tap on the same neighbour adds its letter');
      }
      await ph.click('#clearBtn');
    }

    const before = await snap();
    const countsBefore = await counts();
    const hostLettersBefore = await hostLetters();
    await tapWord();
    await ph.waitForTimeout(250);
    const chips = await ph.locator('#wordline .wchip').allTextContents();
    check(chips.map((t) => t.replace(/\d/g, '')).join('').toLowerCase() === move.word, `word line shows ${move.word.toUpperCase()}`);
    const nChip = await ph.locator('#wordline .wchip').count();
    const chipBox = nChip ? await ph.locator('#wordline .wchip').first().boundingBox() : null;
    check(!!chipBox && chipBox.width >= 44 && chipBox.height >= 44,
      `word-line letter chips are at least 44x44 (${chipBox ? Math.round(chipBox.width) + 'x' + Math.round(chipBox.height) : 'no chips rendered'})`);
    // The shapes must stay CSS-only: this line strips digits, not glyphs, so a
    // glyph in textContent would break the word check just above.
    check(!/[\u25A0-\u25FF\u2605]/.test(await ph.locator('#wordline').textContent()),
      'owner shapes are CSS-only - the word line text is still just the word');
    check(nChip > 0 && /pyramid|black letter/.test(await ph.locator('#wordline .wchip').first().getAttribute('aria-label') || ''),
      'word-line chips name whose pyramid the letter came from');
    const [fr, fc] = cellFor(steps.findIndex((s) => s.kind === 'move'));
    const idx = fr * 10 + fc;
    const countsDuring = await counts();
    const dropped = countsDuring.filter((t, i) => t !== countsBefore[i]).length;
    check(dropped >= 1, `stack counts drop as letters are lifted (${dropped} stacks changed)`);
    check(await ph.locator('#board .cell.glow').count() === move.word.length, 'every square of the word glows');
    check(await ph.locator('#playBtn').isEnabled(), 'Submit is ready');
    check(await hostGlowIs(move.word.length), 'host board glows the word length, like the phone');
    {
      const hc = await hostCounts();
      const hostDropped = hc.filter((t, i) => t !== countsBefore[i]).length;
      check(hostDropped >= 1, `host stack counts drop for lifted cells (${hostDropped})`);
      const hl = await hostLetters();
      const bad = hc.map((t, i) => (t !== countsBefore[i] && hl[i] !== '' && hl[i] !== '?' && hl[i] !== hostLettersBefore[i]) ? i : -1).filter((i) => i >= 0);
      check(bad.length === 0, 'host shows no hidden under-letters');
    }

    // Tap one letter in the word to take it back out
    await ph.locator('#wordline .wchip').last().click();
    check((await ph.locator('#wordline .wchip').count()) === move.word.length - 1, 'tapping a letter removes just that letter');

    await ph.click('#clearBtn');
    check((await ph.locator('#wordline .wchip').count()) === 0, 'Clear empties the word line');
    check(await hostGlowIs(0), 'Clear removes the glow on the host');
    check((await snap()) === before, 'every stack is back exactly as it was');
    check(JSON.stringify(await counts()) === JSON.stringify(countsBefore), 'all stack counts restored');

    // The announcer (M4-01). A toast is a visual event and a screen-reader user
    // gets nothing from it, so toast() also writes its text into a polite live
    // region. Be honest about what this can prove: there is no assistive
    // technology in Playwright, so NOTHING below shows that a screen reader
    // SPEAKS any of it. The three-part proxy - the node exists, it is in the
    // accessibility tree (not display:none or visibility:hidden, either of which
    // silently drops it and nothing would be read), and its text changed - is
    // the most a headless browser can give.
    const srlive = () => ph.evaluate(() => {
      const found = document.querySelectorAll('#srlive');
      if (found.length !== 1) return { count: found.length };
      const el = found[0], cs = getComputedStyle(el);
      return {
        count: 1, live: el.getAttribute('aria-live'), display: cs.display, visibility: cs.visibility,
        width: el.getBoundingClientRect().width, onBody: el.parentElement === document.body,
        text: el.textContent.trim(),
      };
    });
    // A corner runway square is empty, so this toasts and adds nothing to the
    // build: the cheapest deterministic announcement in the suite, and it leaves
    // #board alone (play.html:241 returns before renderGame), so the snapshot
    // comparison further down is unaffected.
    await tap(0, 0);
    await ph.waitForTimeout(150);
    const sr = await srlive();
    check(sr.count === 1, `the page has exactly one live region (${sr.count})`);
    check(sr.live === 'polite', `the live region is polite, so it waits its turn (${sr.live})`);
    check(sr.display !== 'none' && sr.visibility !== 'hidden',
      `the live region stays in the accessibility tree (display ${sr.display}, visibility ${sr.visibility})`);
    check(sr.width <= 2, `the live region is invisible to sighted players (${sr.width}px wide)`);
    check(sr.onBody === true, 'the live region hangs off <body>, not inside the #board innerHTML snapshot');
    check(sr.text === 'That square is empty.', `a toast is announced as well as shown (${sr.text || 'nothing announced'})`);

    // A word that is not in the dictionary: refused with a reason, everything returned.
    // Reversing a real word can land on another real word (the engine drew
    // "span", whose reversal "naps" and rotation "pans" are both in the
    // dictionary), so search a few cheap reorderings of the SAME letters and
    // take the first the dictionary actually rejects, rather than assuming.
    const bl = move.word.split('');
    const ix = bl.map((_, i) => i);
    const asWord = (ord) => ord.map((i) => bl[i]).join('');
    const rot = (k) => [...ix.slice(k), ...ix.slice(0, k)];
    const swap = (k) => { const o = [...ix]; [o[k], o[k + 1]] = [o[k + 1], o[k]]; return o; };
    const candidates = [[...ix].reverse()];
    for (let k = 1; k < bl.length; k++) candidates.push(rot(k), [...rot(k)].reverse());
    for (let k = 0; k < bl.length - 1; k++) candidates.push(swap(k));
    const order = candidates.find((o) => asWord(o) !== move.word && !DICT.has(asWord(o)));
    const scrambled = order ? asWord(order) : '';
    check(!!order && !DICT.has(scrambled), `"${scrambled}" is not a word`);
    // Spell the letters in a different order, with the same squares, by sending the build over the socket path the UI uses.
    await tapWord();
    // Guard the order: with no verified non-word there is nothing to refuse,
    // and handing undefined to the page would throw there and kill the run -
    // the same abort-instead-of-fail trap as an unguarded boundingBox().
    if (order) await ph.evaluate((ord) => { const b = ord.map((i) => build[i]); build.length = 0; build.push(...b); renderGame(); }, order);
    const word2 = order ? await ph.evaluate(() => currentWord()) : '';
    // A scrambled order can put the word off the board, and then Submit stays off (a client-side guard): nothing to send.
    if (order && !DICT.has(word2) && await ph.locator('#playBtn').isEnabled()) {
      // Blank the live region first: an earlier toast's text is still sitting in
      // it, and an empty region after the refusal is the only way to tell that
      // the quiet flag suppressed the duplicate rather than that nothing ran.
      await ph.evaluate(() => { const n = document.getElementById('srlive'); if (n) n.textContent = ''; });
      await ph.click('#playBtn');
      await ph.waitForSelector('#whybox:not(.hidden)', { timeout: 10000 });
      const why = await ph.locator('#whybox').textContent();
      check(why.trim().length > 10, `refused word gives a reason (${why.trim().slice(0, 60)}…)`);

      // The same refusal must not be said twice: #whybox is role="alert" and
      // already reads it out, so the toast beside it goes up quiet.
      const srQuiet = await srlive();
      check(why.trim().length > 10 && srQuiet.text === '',
        `the refusal is announced once, by #whybox alone (live region holds "${srQuiet.text}")`);
      // A refusal keeps the word on the line so the player can fix it; Clear
      // (or any board change) sends every letter back.
      check((await ph.locator('#wordline .wchip').count()) === word2.length, 'refused word stays on the line to fix');
      await ph.click('#clearBtn');
      check((await snap()) === before, 'board is exactly as before once cleared');
    } else {
      await ph.click('#clearBtn');
    }

    // --- Keyboard on the board (M4-01). EVERYTHING below moves focus and the
    // roving tab stop, which is why it sits here, after the last snap()
    // comparison in the suite: a roved, non-canonical stop baked into `before`
    // would have broken the two post-Clear snapshot checks above instead of
    // showing up here, where a failure is cheap to localise. It is still this
    // player's turn - the word above was refused, so the turn never passed.
    // As above: none of this proves a screen reader says anything.
    await ph.bringToFront(); // real key presses, so give the page the keyboard
    const stopCount = await ph.evaluate(() => {
      const cells = [...document.querySelectorAll('#board .cell')];
      const zero = cells.filter((c) => c.getAttribute('tabindex') === '0');
      return {
        zero: zero.length,
        minus: cells.filter((c) => c.getAttribute('tabindex') === '-1').length,
        at: zero.length ? zero[0].dataset.r + ',' + zero[0].dataset.c : 'nowhere',
      };
    });
    // One tab stop, not a hundred: otherwise tabbing past the board costs a
    // keyboard player 100 presses to reach Clear.
    check(stopCount.zero === 1, `exactly one board cell is in the tab order (${stopCount.zero}, at ${stopCount.at})`);
    check(stopCount.minus === 99, `the other 99 are reachable by arrow key only (${stopCount.minus} at tabindex -1)`);

    const activeCell = () => ph.evaluate(() => {
      const a = document.activeElement;
      const cell = a && a.classList && a.classList.contains('cell') ? a : null;
      return {
        rc: cell ? cell.dataset.r + ',' + cell.dataset.c : (a ? '<' + (a.id || a.tagName) + '>' : 'none'),
        tabindex: cell ? cell.getAttribute('tabindex') : null,
        zero: document.querySelectorAll('#board .cell[tabindex="0"]').length,
      };
    });
    const step = (rc, dr, dc) => { const [r, c] = rc.split(',').map(Number); return (r + dr) + ',' + (c + dc); };
    let stop0 = await ph.evaluate(() => {
      const el = document.querySelector('#board .cell[tabindex="0"]');
      if (el) el.focus();
      return el ? el.dataset.r + ',' + el.dataset.c : '';
    });
    // Start from the real stop - that is where a keyboard player lands - but an
    // arrow first if it derived onto the far edge, where ArrowRight/ArrowDown
    // would correctly clamp instead of moving. An arrow press is the right way
    // to get off the edge: it carries the single stop with it, which a bare
    // .focus() would not, leaving two cells at tabindex 0.
    if (/,9$/.test(stop0)) { await ph.keyboard.press('ArrowLeft'); await ph.waitForTimeout(80); stop0 = (await activeCell()).rc; }
    if (/^9,/.test(stop0)) { await ph.keyboard.press('ArrowUp'); await ph.waitForTimeout(80); stop0 = (await activeCell()).rc; }
    await ph.keyboard.press('ArrowRight');
    await ph.waitForTimeout(80);
    let moved = await activeCell();
    check(moved.rc === step(stop0, 0, 1), `ArrowRight moves focus along the row (${stop0} -> ${moved.rc})`);
    check(moved.tabindex === '0' && moved.zero === 1, `the tab stop travels with the focus and stays single (${moved.zero} at tabindex 0)`);
    const stop1 = moved.rc;
    await ph.keyboard.press('ArrowDown');
    await ph.waitForTimeout(80);
    moved = await activeCell();
    check(moved.rc === step(stop1, 1, 0), `ArrowDown moves focus down the column (${stop1} -> ${moved.rc})`);
    check(moved.tabindex === '0' && moved.zero === 1, `the stop travels on that move too (${moved.zero} at tabindex 0)`);
    // The grid clamps at its edges and never wraps: wrapping out of the corner
    // would lose a blind player their place entirely.
    await ph.evaluate(() => document.querySelectorAll('#board .cell')[0].focus());
    await ph.keyboard.press('ArrowLeft');
    await ph.keyboard.press('ArrowUp');
    await ph.waitForTimeout(80);
    const corner = await activeCell();
    check(corner.rc === '0,0', `ArrowLeft and ArrowUp clamp in the top-left corner rather than wrap (${corner.rc})`);

    // Enter has activated a cell since the board was keyed (board.js:256-259)
    // and nothing had ever tested it.
    const chipsBeforeEnter = await ph.locator('#wordline .wchip').count();
    const enterAt = await ph.evaluate(() => {
      const el = [...document.querySelectorAll('#board .cell')].find((c) => c.querySelector('.tile'));
      if (el) el.focus();
      return el ? el.dataset.r + ',' + el.dataset.c : 'no tile on the board';
    });
    await ph.keyboard.press('Enter');
    await ph.waitForTimeout(200);
    check((await ph.locator('#wordline .wchip').count()) === chipsBeforeEnter + 1,
      `Enter on a square plays its letter with no tap (${enterAt})`);

    // The invariant the whole roving design rests on: the stop lives in an
    // attribute that is already there and is re-derived on every render, so a
    // post-Clear board is byte-for-byte the board `before` captured even after
    // all that arrowing. A failure here means the stop is being churned -
    // removeAttribute/setAttribute re-appends, which reorders the attribute list
    // that innerHTML serialises - or that a roved stop outlived the Clear.
    // clearIfAny, not a bare click: with no letter on the line Clear is disabled
    // and click() would wait out its full timeout and abort the whole run.
    await clearIfAny();
    await ph.waitForTimeout(250);
    check((await snap()) === before, 'arrowing and clearing leaves the board byte-identical');

    // Focus survives the word line being patched in place: renderGame() runs on
    // every inbound state and draft message - drafts land roughly every 120ms -
    // and the chip under the player's finger used to be thrown away each time.
    const twoTiles = await ph.evaluate(() => {
      const out = [];
      // Plain coloured tops only: no house pyramid, so the build has no black
      // letter and therefore no anchor, so neither tap can be swallowed as a
      // direction tap - and no '?' top, whose letter is not known here.
      state.cells.forEach((row, r) => row.forEach((cell, c) => {
        if (out.length < 2 && cell.t && cell.t.o !== 'house' && cell.t.o !== 'hidden') out.push([r, c]);
      }));
      return out;
    });
    if (twoTiles.length === 2) {
      await tap(...twoTiles[0]);
      await ph.waitForTimeout(150);
      // Tag the chip as well as focusing it: a patched chip is the same node, so
      // the tag survives; a rebuilt line loses it, and that is the bug.
      await ph.evaluate(() => { const b = document.querySelector('#wordline .wchip'); if (b) { b.dataset.probe = '1'; b.focus(); } });
      await tap(...twoTiles[1]);
      await ph.waitForTimeout(250);
      const held = await ph.evaluate(() => {
        const a = document.activeElement;
        return {
          same: !!(a && a.dataset && a.dataset.probe === '1'),
          where: a ? (a.className || a.id || a.tagName) : 'none',
          chips: document.querySelectorAll('#wordline .wchip').length,
        };
      });
      check(held.chips === 2 && held.same,
        `focus stays on the same chip while another letter is added (${held.chips} chips, focus on ${held.where})`);
      const heldBox = (await ph.locator('#wordline .wchip').count()) ? await ph.locator('#wordline .wchip').first().boundingBox() : null;
      check(!!heldBox && heldBox.width >= 44 && heldBox.height >= 44,
        `patched-in-place chips are still at least 44x44 (${heldBox ? Math.round(heldBox.width) + 'x' + Math.round(heldBox.height) : 'no chips rendered'})`);
      await clearIfAny();
    } else {
      check(false, `could not find two plain tiles to build with (${twoTiles.length})`);
    }

    // Focus rings, measured on the rendered page rather than read off the
    // stylesheet. :focus-visible does NOT match a programmatic .focus() in every
    // engine, so drive it with a real Tab press - which is what a keyboard
    // player does anyway. Tab out of the board (one press, because of the single
    // stop) and the next tabbable thing is a control button: Clear, or Submit
    // and Pass when Clear is disabled, since disabled buttons are skipped. The
    // label says which one was measured.
    await ph.evaluate(() => {
      const el = document.querySelector('#board .cell[tabindex="0"]');
      if (el) el.focus();
    });
    await ph.keyboard.press('Tab');
    const ring = await ph.evaluate(() => {
      const a = document.activeElement, cs = getComputedStyle(a);
      return { btn: !!(a.classList && a.classList.contains('btn')), who: a.id || a.className || a.tagName, style: cs.outlineStyle, width: cs.outlineWidth };
    });
    check(ring.btn && ring.style !== 'none' && parseFloat(ring.width) > 0,
      `a button focused from the keyboard draws a focus ring (${ring.who}: outline ${ring.style} ${ring.width})`);

    // The good word goes through and lands in the words panel on both screens.
    await clearIfAny();
    // No direction tap at all: the effective direction (Across, or Down when Across cannot fit) is used
    // (a letter that sits beside the black one would count as a direction tap, so skip then)
    const beside = cells.slice(ai + 1).some(([r, c]) => Math.abs(r - ar) + Math.abs(c - ac) === 1);
    if (!beside) {
      await tapWord({ noDir: true });
      await ph.waitForTimeout(150);
      check((await ph.evaluate(() => currentWord())) === move.word, 'letters tapped without any direction tap');
      if (move.dir === 'H') check((await ph.evaluate(() => dir)) === 'H', 'default direction is Across');
    }
    await clearIfAny();
    await tapWord();
    await ph.waitForFunction(() => !document.getElementById('playBtn').disabled);
    await ph.click('#playBtn');
    await ph.waitForFunction((w) => document.getElementById('wordspanel').textContent.toUpperCase().includes(w), move.word.toUpperCase(), { timeout: 10000 });
    check(true, 'accepted word appears in the phone words panel');
    await host.waitForFunction((w) => document.getElementById('log').textContent.toUpperCase().includes(w), move.word.toUpperCase(), { timeout: 10000 });
    check(true, 'and in the big-screen words panel, under the player');
    check((await host.locator('#log').textContent()).includes('Hana'), 'under the host player\'s name');
    check(await ph.locator('#turnbanner').textContent().then((t) => /Waiting for/.test(t)), 'turn passed on');
    check(await hostGlowIs(0), 'Submit leaves no glow on the host');
  } finally {
    for (const s of scripted) s.close();
    await browser.close();
    // Wait for the server to actually exit before removing its store dir:
    // kill() returns at once, and a dying child still touching the lock or
    // checkpoint files turns the rmSync into an ENOTEMPTY crash.
    const stopped = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill();
    await stopped;
    fs.rmSync(storeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(failures === 0 ? '\nTAP-TO-BUILD CHECKS ALL PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
