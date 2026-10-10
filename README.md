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
  (or after two full rounds of passes).
- **Your score is the tip values of every pyramid you hold, added up** — minus
  the tips of **your own colour still left on the board**, which count against
  you. Highest total wins; a tie is settled by a draw: each tied player takes a
  pyramid at random and the highest tip wins.

### Digital adaptations from the tabletop rules

- Word validity is checked automatically against a 359k-word English
  dictionary, so the challenge/forfeit flow isn't needed — illegal words are
  simply rejected with no penalty and the turn continues.
- Words are straight lines only (runway squares can be used, but the corner
  "bend" rule is not implemented). The runway is optional space: use it or
  ignore it. Note that the outermost ring is empty, so a word cannot be built
  there on its own — every word still needs one black letter in place, which
  means a house pyramid or a printed square.
- "Lowest exposed tips goes first" is applied; if that total ties, the earlier
  seat starts rather than removing a layer. (The *winner* tie-break at the end
  of the game is a random draw, as above.)

## Deploying a public link

**On AWS:** see [`deploy/aws.md`](deploy/aws.md) — one small always-on instance
(Lightsail or EC2), with `deploy/pyramids.service` and `deploy/Caddyfile` for
systemd and HTTPS. Verify current instance prices and supported Node version
before provisioning.

**Hosted single-instance option:**

`render.yaml` is a Render blueprint for the Starter plan and includes a 1 GB
persistent disk for restart checkpoints. Confirm Render's current plan and disk
terms before use. Connect the repo at [dashboard.render.com](https://dashboard.render.com)
→ **New → Blueprint**, and Render builds `main` and serves it at a permanent URL:

```
https://crossword-pyramids.onrender.com          ← host screen: /host.html
```

That URL stays stable across deploys, so it is safe to share or bookmark.
Rooms are saved to the instance's configured persistent disk, letting active
rooms recover after a process restart. Use one server instance: the local file
is not shared across replicas and is not a backup.
This example uses an always-on plan with its persistent disk. Free web services
may sleep and generally do not provide that disk setup; use them only with an
explicit no-durability expectation. If a provider plan sleeps, warm the service
before play. Host/player screens ping `/health` every 10 minutes while open; this
is only a keep-awake hint and does not preserve state on ephemeral storage.

If first-request wake delay is not acceptable, choose an always-on plan. Confirm current provider pricing, disk availability, sleep policy and instance-hour limits before choosing; these change over time. Keep one instance because checkpoints are local, and configure `ROOM_STORE_PATH` on the mounted persistent disk.

### Dropped phones, reconnecting and public deployment

- Active rooms are checkpointed atomically to `data/rooms.json` by default. Set `ROOM_STORE_PATH` to a path on persistent local storage to move the checkpoint. The file includes private credential hashes and game state, not raw tokens: protect the directory and include it in encrypted backups. Restore only onto one server instance; do not run multiple writers against the same file or use ephemeral storage if restart recovery is part of your promise.
- On restart, rooms younger than two hours and inside the 10-minute host-recovery window are restored; hosts resume with their host credential and players reclaim seats with their player credentials. Disconnected human turns resume the existing 30-second skip/pass policy; a crash does not reset that deadline. Malformed/unsupported checkpoints fail startup rather than silently discarding all rooms.
- Recovery means process restart on the same intact disk, **not** high availability or backup/restore. Host grace and idle expiry still close rooms; take encrypted backups and rehearse restore if you need disaster recovery.
- There is no turn clock. The only timer is a safety net: if it is a human's turn and their phone has been disconnected for 30 seconds (`GONE_MS`), the turn is skipped and **counts as a pass**. Two full rounds of consecutive passes end the game, so if every human drops, the game can end by stalemate.
- A phone reclaims its seat only with the credential the server gave it when it joined (kept in that tab's session storage); a name alone is not enough. The host screen likewise resumes its room only with its own credential.
- On the public internet set `PUBLIC_ORIGIN=https://your-domain` (the server refuses to start in production without it). Behind a reverse proxy also set `TRUST_PROXY=1` so per-address limits see the real client address.
- Abuse limits (per address): 5 new rooms/minute, 10 wrong room codes/minute, 20 open sockets; `MAX_ROOMS` (default 200) caps rooms.

## Tech

- Node.js + Express + `ws` (no build step); vanilla JS frontend
- `qrcode` for join QR generation; four-letter rooms use atomic local checkpoints for single-instance restart recovery
- Server-authoritative rules engine in `server/game.js` (pure, unit-tested)
- Built-in AI opponents (`findMove`) used both in-game and by the test harness

## Testing

```bash
npm test           # rules engine unit tests (node:test)
npm run e2e        # spawns the real server, verifies room codes + decodes the
                   # QR PNG, then AI players play 5 full games over WebSockets
node test/ui.js    # legacy Playwright browser test; run the current 3D flow with
                   # node test/visual-3d.js (Chromium + SwiftShader required)
```

See `TEST_REPORT.md` for the latest results.
