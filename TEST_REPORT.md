# Crossword Pyramids — Pre-Release Test Report

**Date:** 2026-07-21 · **Verdict: PASS — ready for release review**

All three test layers pass: 10/10 rules-engine unit tests, the full
online-hosting e2e suite (room codes, QR codes, and 5 complete AI-vs-AI games
over real WebSockets), and the Playwright browser test of the actual UI
(home page, host lobby, phone join via the QR link, a full televised game,
and mid-game phone rejoin).

## 1. Rules engine unit tests — 10/10 pass (`npm test`)

- Board setup: 4×30 player pyramids in 5-high stacks on the correct colored
  spaces, 36 of 42 house pyramids on the inner squares, printed letters
  (including the Y-R-A-M-I-D start spaces), empty Word Runway ring
- "Lowest exposed tips goes first" verified
- Rejections: wrong turn, non-dictionary words, words under 3 letters,
  words that run off the board, words lacking an own pyramid / black letter
- Pyramid conservation across moves (nothing created or destroyed)
- The "uncovered pyramid can't be used the same turn" rule (max one pyramid
  leaves any cell per turn)
- Pass-stalemate ending, color-exhaustion ending, final scoring with
  remaining-pyramid deductions, winner selection
- Client serialization exposes only public info (stack tops)

## 2. Online hosting e2e — ALL CHECKS PASSED (`npm run e2e`)

The harness spawns the real server, then exercises it exactly as browsers do:

- **Health + static pages** served (/, host.html, play.html, assets)
- **Room codes**: correct 4-letter format (ambiguous I/O excluded); joining a
  bad code is rejected; a 5th player is rejected when the room is full;
  unique colors are assigned in seat order
- **QR codes**: the QR PNG from the host lobby is *decoded* (jsqr) and
  verified to contain the exact join URL for the room — 5/5 rooms correct
- **5 full games played by AI** over independent WebSocket connections
  (mixing 2, 3, and 4 players):

| Game | Players | Winner | Turns | Words | Time | Final scores |
|------|---------|--------|-------|-------|------|--------------|
| 1 | 2 | red | 24 | 24 | 0.2s | red 146, blue 135 |
| 2 | 3 | green | 37 | 37 | 0.5s | red 120, blue 113, green 139 |
| 3 | 4 | green | 27 | 27 | 0.4s | red 49, blue 68, green 84, yellow 24 |
| 4 | 2 | red | 27 | 27 | 0.1s | red 174, blue 116 |
| 5 | 3 | red | 26 | 26 | 0.1s | red 114, blue 71, green 87 |

Every game reached a legitimate game-over (color exhausted), the winner always
held the top final score, and **zero bot moves were rejected by the server** —
the client-visible state and the server rules engine agree completely.

## 3. Browser UI test — ALL CHECKS PASSED (`node test/ui.js`)

Playwright driving real Chromium (desktop host + 390×844 "phone" viewport):

- Home page renders title, marketing panels, Host/Join buttons, join-code box
- Host screen shows the room code, the QR image, and the join URL
- A phone opening the QR link lands with the room code pre-filled, joins as
  "Cleo", gets the red seat, and appears in the host lobby
- Host adds 2 AI players, starts, the 100-cell board renders, and the game
  plays live on the big screen to the **Game Over overlay with the winner**
- A phone that disconnects mid-game **rejoins with the same name** and gets
  its seat and live board back (plus automatic reconnect on the client)

Screenshots captured in `screenshots/` (home, host lobby, host game,
game over, phone lobby, phone game).

## Bugs found and fixed during testing

1. **Playwright/browser version mismatch** — launch failed until pointed at
   the environment's pre-installed Chromium.
2. **Mid-game disconnects stalled games** — originally a dropped phone could
   never return, deadlocking the turn order. Added seat-reclaim-by-name on the
   server and automatic reconnection (including on phone unlock) on the client.
3. **Bot move search was too slow** for 3s turn budgets on busy boards —
   fixed with a per-turn letter→source index (games now finish in <1s of
   compute).

## Known limitations (deliberate scope for v1)

- The Word Runway supports straight extensions but not the corner "bend"
  from the tabletop rules.
- Word challenges are unnecessary (the 359k-word dictionary is authoritative);
  invalid words are rejected without the turn-forfeit penalty.
- Rooms are in-memory: a server restart drops active games, and the host tab
  closing closes the room. Fine for party play; use a process manager and
  sticky sessions if scaling out.
- The first-player tie-break uses seat order rather than the physical
  "remove a layer and recount".

## Release recommendation

Ship it. Core rules, hosting, QR/room-code join, phones-as-controllers, AI
opponents, and full-game stability are all verified. Suggested fast-follows:
runway bends, spectator mode, per-turn timers, and sound effects.
