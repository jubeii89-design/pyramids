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

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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
    await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
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
    check(await phone.locator('#mycolor').textContent().then((t) => /red/i.test(t)), 'phone got red (first seat)');
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
    const pyrCount = await host.locator('#board .pyr').count();
    check(pyrCount >= 60, `3D pyramid pieces render (${pyrCount} on board)`);
    check((await host.locator('#board .pyr .peak').first().textContent()).match(/^[1-9]$/), 'peak value plates visible');
    check((await host.locator('#board .pyr .cnt').count()) >= 20, 'stack count chips visible on stacks');
    check((await host.locator('#tracker .trk').count()) === 5, 'pyramid tracker shows 4 colors + house');
    check((await host.locator('#tracker').textContent()).includes('Gold'), 'Gold color naming in tracker');
    await host.screenshot({ path: path.join(SHOTS, 'host-game.png') });
    await host.waitForSelector('#over:not(.hidden)', { timeout: 180000 });
    const finals = await host.locator('#finals').textContent();
    check(/wins!/.test(finals), `game over overlay shows winner (${finals.trim().slice(0, 60)}…)`);
    await host.screenshot({ path: path.join(SHOTS, 'host-gameover.png') });

    // --- D: mid-game rejoin from a phone
    console.log('D) Rejoin check');
    const host2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host2.goto(`${BASE}/host.html`);
    await host2.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
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
    check((await p1.locator('#board .pyr').count()) >= 60, 'phone renders 3D pyramids');
    check((await p1.locator('#tracker .trk').count()) === 5, 'phone shows pyramid tracker');
    await p1.screenshot({ path: path.join(SHOTS, 'phone-game.png') });
    await p1.close(); // simulate phone dropping mid-game
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.goto(`${BASE}/play.html?room=${code2}`);
    await p2.fill('#namein', 'Memphis');
    await p2.click('#joinBtn');
    await p2.waitForSelector('#gameview:not(.hidden)', { timeout: 15000 });
    check(true, 'disconnected player rejoined mid-game and sees the board');
    await host2.close(); await p2.close();

    // --- E: spelling glow preview + scores hidden until the end
    console.log('E) Spelling glow + hidden scores');
    const host3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host3.goto(`${BASE}/host.html`);
    await host3.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
    const code3 = await host3.locator('#code').textContent();
    const ph = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await ph.goto(`${BASE}/play.html?room=${code3}`);
    await ph.fill('#namein', 'Cleo');
    await ph.click('#joinBtn');
    await ph.waitForSelector('#waitview:not(.hidden)');
    await host3.click('#botBtn');
    await host3.waitForFunction(() => document.querySelectorAll('#players li').length === 2);
    await host3.click('#startBtn');
    await ph.waitForSelector('#gameview:not(.hidden)');

    // No point values anywhere on either screen mid-game
    const hostTxt = await host3.locator('#scores').textContent();
    check(!/\d/.test(hostTxt), 'host shows no point numbers during play');
    const phoneTxt = await ph.locator('#scoresmini').textContent();
    check(!/:\s*\d/.test(phoneTxt), 'phone shows no point numbers during play');

    // Wait for the phone's turn, then tap a start square and type a word
    await ph.waitForFunction(
      () => document.getElementById('turnbanner').classList.contains('mine'),
      { timeout: 30000 }
    );
    await ph.evaluate(() => document.querySelectorAll('#board .cell')[43].click());
    await ph.fill('#wordin', 'CAT');
    await ph.waitForTimeout(300);
    const glowCount = await ph.locator('#board .cell.glow').count();
    check(glowCount === 3, `spelling path glows for each letter (${glowCount} of 3)`);
    check((await ph.locator('#board .cell.glow-start').count()) === 1, 'start square is marked');
    const previewed = await ph.locator('#board .ghost-letter').count();
    const matched = await ph.locator('#board .cell.glow-match').count();
    check(previewed + matched === 3, `all 3 letters previewed on the board (${previewed} ghost + ${matched} in place)`);
    // Countdown timer is running on the player's turn
    check(/\d+s to spell/.test(await ph.locator('#turnbanner').textContent()), 'turn countdown shown on phone');
    await ph.screenshot({ path: path.join(SHOTS, 'phone-spelling.png') });
    await host3.close(); await ph.close();

    // --- F: game-over options (play again / main menu) on both screens
    console.log('F) Game over options');
    const host4 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await host4.goto(`${BASE}/host.html`);
    await host4.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('code').textContent));
    const code4 = await host4.locator('#code').textContent();
    const phones = [];
    for (const name of ['Cleo', 'Memphis', 'Sais']) {
      const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
      p.on('dialog', (d) => d.accept()); // the Pass confirm()
      await p.goto(`${BASE}/play.html?room=${code4}`);
      await p.fill('#namein', name);
      await p.click('#joinBtn');
      await p.waitForSelector('#waitview:not(.hidden)');
      phones.push(p);
    }
    await host4.waitForFunction(() => document.querySelectorAll('#players li').length === 3);
    await host4.click('#startBtn');
    for (const p of phones) await p.waitForSelector('#gameview:not(.hidden)');

    // Two full rounds of passes is a stalemate, which ends the game right away
    const passToGameOver = async (players) => {
      for (let i = 0; i < 12; i++) {
        const over = await host4.evaluate(() => !document.getElementById('over').classList.contains('hidden'));
        if (over) break;
        for (const p of players) {
          const mine = await p.evaluate(() => state && state.phase === 'playing' && state.current === myColor);
          if (mine) await p.click('#passBtn');
        }
        await host4.waitForTimeout(200);
      }
      await host4.waitForSelector('#over:not(.hidden)', { timeout: 20000 });
    };
    await passToGameOver(phones);
    check(await host4.locator('#againBtn').isVisible(), 'host game over offers Play Again');
    check(await host4.locator('#menuBtn').isVisible(), 'host game over offers Main Menu');
    for (const p of phones) await p.waitForSelector('#overview:not(.hidden)');
    check(await phones[0].locator('#againBtn').isVisible(), 'phone game over offers Play Again');
    check(await phones[0].locator('#menuBtn').isVisible(), 'phone game over offers Main Menu');
    await phones[0].screenshot({ path: path.join(SHOTS, 'phone-gameover.png') });

    // Main Menu takes a player home and frees their seat
    await phones[2].click('#menuBtn');
    await phones[2].waitForURL(`${BASE}/`);
    check(await phones[2].locator('.btn', { hasText: 'Host Game' }).isVisible(), 'Main Menu returns to the home screen');
    await host4.waitForFunction(() => document.querySelectorAll('#players li').length === 2);
    check(true, 'the player who went to the main menu is no longer seated');

    // Host hits Play Again: the phones still connected go straight into a new
    // game on the same room code — no second trip through the lobby.
    const staying = [phones[0], phones[1]];
    await host4.click('#againBtn');
    for (const p of staying) await p.waitForSelector('#gameview:not(.hidden)', { timeout: 10000 });
    check(await host4.locator('#gamearea').isVisible() && await host4.locator('#over').isHidden(),
      'host goes straight to a fresh board on Play Again');
    check((await staying[0].locator('#board .cell').count()) === 100, 'phone renders the new board');
    check(await staying[0].evaluate(() => state.phase === 'playing' && state.log.length === 0), 'the new game starts clean');
    check((await staying[0].locator('#roomcode').textContent()) === code4, 'same room code carries over');
    check(await staying[0].evaluate(() => state.players.includes(myColor)), 'the player keeps a seat in the new game');
    check(await staying[0].locator('#overview').isHidden(), 'phone leaves the results screen on a new round');

    // With too few players left for a board, Play Again falls back to the lobby
    await passToGameOver(staying);
    await staying[1].click('#menuBtn');
    await staying[1].waitForURL(`${BASE}/`);
    await host4.click('#againBtn');
    await host4.waitForSelector('#lobby:not(.hidden)');
    await staying[0].waitForSelector('#waitview:not(.hidden)', { timeout: 10000 });
    check(true, 'Play Again with only one player left waits in the lobby');
    await host4.close();
    for (const p of phones) await p.close();
  } finally {
    await browser.close();
    proc.kill();
  }

  console.log(failures === 0 ? '\nUI CHECKS ALL PASSED' : `\n${failures} UI CHECKS FAILED`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
