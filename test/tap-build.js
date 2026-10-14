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
    const tapWord = async ({ noDir = false } = {}) => {
      for (let i = 0; i <= ai; i++) { await tap(...cells[i]); await ph.waitForTimeout(60); }
      if (!noDir) { await tap(...nb); await ph.waitForTimeout(60); }
      for (let i = ai + 1; i < cells.length; i++) { await tap(...cells[i]); await ph.waitForTimeout(60); }
    };
    const hostCounts = () => host.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c) => (c.querySelector('.n') || {}).textContent || ''));
    const hostLetters = () => host.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c) => (c.querySelector('.L') || {}).textContent || ''));
    const hostGlowIs = (n) => host.waitForFunction((k) => document.querySelectorAll('#board .cell.glow').length === k, n, { timeout: 5000 }).then(() => true, () => false);

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

    // A word that is not in the dictionary: refused with a reason, everything returned.
    let scrambled = move.word.split('').reverse().join('');
    if (DICT.has(scrambled) || scrambled === move.word) scrambled = move.word.slice(1) + move.word[0];
    check(!DICT.has(scrambled), `"${scrambled}" is not a word`);
    // Spell the letters in a different order, with the same squares, by sending the build over the socket path the UI uses.
    await tapWord();
    await ph.evaluate((w) => { build.reverse(); renderGame(); }, scrambled);
    const word2 = await ph.evaluate(() => currentWord());
    // A scrambled order can put the word off the board, and then Submit stays off (a client-side guard): nothing to send.
    if (!DICT.has(word2) && await ph.locator('#playBtn').isEnabled()) {
      await ph.click('#playBtn');
      await ph.waitForSelector('#whybox:not(.hidden)', { timeout: 10000 });
      const why = await ph.locator('#whybox').textContent();
      check(why.trim().length > 10, `refused word gives a reason (${why.trim().slice(0, 60)}…)`);
      check((await ph.locator('#wordline .wchip').count()) === 0, 'letters were sent back after the refusal');
      check((await snap()) === before, 'board is exactly as before the refused word');
    } else {
      await ph.click('#clearBtn');
    }

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
    proc.kill();
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
  console.log(failures === 0 ? '\nTAP-TO-BUILD CHECKS ALL PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
