'use strict';
// Browser UI smoke test with Playwright:
//  A) home page renders, join box works
//  B) host screen shows room code + QR; a phone joins via the QR URL and
//     appears in the lobby with the right color
//  C) host adds 2 AI players, starts, and the game plays to the Game Over
//     overlay on the big screen while the phone sees the live board
// Usage: node test/ui.js

const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3124;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(__dirname, '..', 'screenshots');

let failures = 0;
function check(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
}

async function main() {
  const proc = spawn('node', ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('listening') && res());
    setTimeout(() => rej(new Error('server start timeout')), 15000);
  });

  const browser = await chromium.launch();
  try {
    require('fs').mkdirSync(SHOTS, { recursive: true });

    // --- A: Home page
    console.log('A) Home page');
    const home = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await home.goto(BASE);
    check((await home.title()).includes('Crossword Pyramids'), 'title renders');
    check(await home.locator('.btn', { hasText: 'Host Game' }).isVisible(), 'Host Game button visible');
    await home.locator('.btn', { hasText: 'Join Game' }).click();
    check(await home.locator('#code').isVisible(), 'join code box opens');
    await home.screenshot({ path: path.join(SHOTS, 'home.png'), fullPage: true });

    // --- B: Host + phone join
    console.log('B) Host + phone join');
    const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host.goto(`${BASE}/host.html`);
    await host.waitForFunction(() => document.getElementById('code').textContent.length === 4);
    const code = await host.locator('#code').textContent();
    check(/^[A-Z]{4}$/.test(code), `room code shown (${code})`);
    const qrSrc = await host.locator('#qr').getAttribute('src');
    check(qrSrc && qrSrc.startsWith('data:image/png;base64,'), 'QR image rendered');
    const joinUrl = await host.locator('#joinurl').textContent();
    check(joinUrl === `${BASE}/play.html?room=${code}`, 'join URL displayed');

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish
    await phone.goto(joinUrl); // what scanning the QR does
    check(await phone.locator('#codein').isHidden(), 'room code prefilled from QR link');
    await phone.fill('#namein', 'Cleo');
    await phone.click('#joinBtn');
    await phone.waitForSelector('#waitview:not(.hidden)');
    check(await phone.locator('#mycolor').textContent().then((t) => t.includes('red')), 'phone got red (first seat)');
    await host.waitForFunction(() => document.querySelectorAll('#players li').length === 1);
    check((await host.locator('#players li').first().textContent()).includes('Cleo'), 'host lobby shows Cleo');
    await host.screenshot({ path: path.join(SHOTS, 'host-lobby.png') });
    await phone.screenshot({ path: path.join(SHOTS, 'phone-lobby.png') });

    // --- C: add bots, start, run to game over (phone leaves; bots-only game)
    console.log('C) Full game on the big screen');
    await phone.close(); // seat is removed in lobby phase
    await host.waitForFunction(() => document.querySelectorAll('#players li').length === 0);
    await host.click('#botBtn');
    await host.click('#botBtn');
    await host.waitForFunction(() => document.querySelectorAll('#players li').length === 2);
    check(true, 'two AI players added');
    // speed the bots up for the test
    await host.click('#startBtn');
    await host.waitForSelector('#gamearea:not(.hidden)');
    check((await host.locator('#board .cell').count()) === 100, 'board renders 100 cells');
    await host.screenshot({ path: path.join(SHOTS, 'host-game.png') });
    await host.waitForSelector('#over:not(.hidden)', { timeout: 180000 });
    const finals = await host.locator('#finals').textContent();
    check(/wins!/.test(finals), `game over overlay shows winner (${finals.trim().slice(0, 60)}…)`);
    await host.screenshot({ path: path.join(SHOTS, 'host-gameover.png') });

    // --- D: mid-game rejoin from a phone
    console.log('D) Rejoin check');
    const host2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host2.goto(`${BASE}/host.html`);
    await host2.waitForFunction(() => document.getElementById('code').textContent.length === 4);
    const code2 = await host2.locator('#code').textContent();
    const p1 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p1.goto(`${BASE}/play.html?room=${code2}`);
    await p1.fill('#namein', 'Memphis');
    await p1.click('#joinBtn');
    await p1.waitForSelector('#waitview:not(.hidden)');
    await host2.click('#botBtn');
    await host2.waitForFunction(() => document.querySelectorAll('#players li').length === 2);
    await host2.click('#startBtn');
    await p1.waitForSelector('#gameview:not(.hidden)');
    check((await p1.locator('#board .cell').count()) === 100, 'phone renders live board');
    await p1.screenshot({ path: path.join(SHOTS, 'phone-game.png') });
    await p1.close(); // simulate phone dropping mid-game
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.goto(`${BASE}/play.html?room=${code2}`);
    await p2.fill('#namein', 'Memphis');
    await p2.click('#joinBtn');
    await p2.waitForSelector('#gameview:not(.hidden)', { timeout: 15000 });
    check(true, 'disconnected player rejoined mid-game and sees the board');
    await host2.close(); await p2.close();
  } finally {
    await browser.close();
    proc.kill();
  }

  console.log(failures === 0 ? '\nUI CHECKS ALL PASSED' : `\n${failures} UI CHECKS FAILED`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
