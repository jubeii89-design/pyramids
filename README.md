# Crossword Pyramids — Spell to Win!

A Jackbox-style online party version of the Crossword Pyramids board game.
Host the game on a big screen; players join from their phones by scanning a
QR code or entering a 4-letter room code.

## Quick start

Requires Node 18+. Run both commands **from inside the cloned repo folder** —
npm reads `package.json` from the current directory, so running them anywhere
else fails with `ENOENT: no such file or directory, open '...package.json'`.

```bash
git clone https://github.com/jubeii89-design/pyramids.git
cd pyramids        # ← npm start only works from here
npm install
npm start          # serves on http://localhost:3000
```

- Open `/` for the marketing home page → **Host Game** or **Join Game**
- The host screen generates a **room code + QR code**; phones that scan it land
  directly in the room
- 2–4 players; the host can add **AI opponents** to fill seats

### Playing with phones on your network

The server listens on all interfaces, and the QR code is built from whatever
address the host screen is open at. So open the host page at your machine's LAN
address — `http://192.168.1.23:3000/host.html`, not `localhost` — and the QR
code your phones scan will point back at that same address. A QR generated from
a `localhost` host screen will not work on a phone. Find your LAN address with
`ipconfig` on Windows or `ipconfig getifaddr en0` on macOS, and allow Node
through the firewall if Windows prompts you.

Change the port with `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`).

## How it plays

- 10×10 board. The outer ring is the **Word Runway**; the inner 6×6 squares
  carry printed letters covered by 36 black **house pyramids**; each of the four
  colors starts with 30 pyramids in six stacks of five.
- On your turn: tap the square where your word starts, choose Across/Down, and
  type a word (3+ letters). The engine automatically uses matching exposed
  letters in place and moves exposed player pyramids (yours *or* stolen from
  opponents) to complete the word.
- Every word must be in the dictionary and must use at least **one of your own
  pyramids** and **one black letter** (house pyramid or printed board letter),
  and must move at least one pyramid.
- All pyramids used in the word are captured and score their **tip values**
  (1–9). Printed letters score nothing and stay on the board.
- The game ends when any seated player's color is fully cleared from the board
  (or after two full rounds of passes). Remaining pyramids of your color on the
  board **count against you**. Highest score wins.

### Digital adaptations from the tabletop rules

- Word validity is checked automatically against a 359k-word English
  dictionary, so the challenge/forfeit flow isn't needed — illegal words are
  simply rejected with no penalty and the turn continues.
- Words are straight lines only (runway squares can be used, but the corner
  "bend" rule is not implemented).
- "Lowest exposed tips goes first" is applied; the tie-break recount uses seat
  order instead of removing a layer.

## Deploying a public link

`render.yaml` is a Render blueprint for the free plan. Connect the repo at
[dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**, and
Render builds `main` and serves it at a permanent URL:

```
https://crossword-pyramids.onrender.com          ← host screen: /host.html
```

That URL never changes — not between deploys, not when the service sleeps — so
it is safe to share or bookmark. Rooms live in memory, so a restart ends any
game in progress; the link itself stays put.

**The one catch on the free plan:** a free service spins down after 15 minutes
with no traffic, and the next request takes about a minute to wake it. The QR
code your players scan is only handed out by an awake server, so:

1. Open `/host.html` yourself a minute or two before anyone joins. The first
   load is the slow one; the room code appears once the server is up.
2. Then show the QR. Phones scanning it hit a warm server and join instantly.
3. While any host or player screen is open it pings `/health` every 10 minutes,
   so the service will not fall asleep between rounds or during a long turn.

If waiting on that first load is not acceptable — a link you want live at any
moment, unannounced — the options are Render's Starter plan at $7/month (no
spin-down), or a free external uptime pinger (cron-job.org and similar) hitting
`/health` every 10 minutes. Note that pinging around the clock consumes roughly
744 of the 750 free instance-hours a workspace gets each month, so schedule the
pings for the hours you actually play rather than 24/7.

## Tech

- Node.js + Express + `ws` (no build step); vanilla JS frontend
- `qrcode` for join QR generation; rooms are in-memory with 4-letter codes
- Server-authoritative rules engine in `server/game.js` (pure, unit-tested)
- Built-in AI opponents (`findMove`) used both in-game and by the test harness

## Testing

```bash
npm test           # rules engine unit tests (node:test)
npm run e2e        # spawns the real server, verifies room codes + decodes the
                   # QR PNG, then AI players play 5 full games over WebSockets
node test/ui.js    # Playwright browser test: home page, host QR lobby, phone
                   # join, full televised bot game, mid-game phone rejoin
```

See `TEST_REPORT.md` for the latest results.
