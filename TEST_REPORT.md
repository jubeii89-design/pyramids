# Crossword Pyramids — Test Report

**Last run:** 2026-10-03, on the current `claude/session-hsd67f` head.

Three layers, all passing. Every "player" below is a bot or a script — see
**Not covered** at the end, which is the honest part of this document.

## 1. Rules engine — 14/14 pass (`npm test`)

Pure unit tests against `server/game.js`: setup counts and layout, first-player
rule, four rejection paths, an AI move applied and scored, pyramid conservation
over six plies, the own-pyramid + black-letter requirement, pass-stalemate
ending, end-by-exhaustion, serialization shape, scores hidden until game over,
the pyramid tracker, and the uncovered-tops rule. Scoring is covered twice
over: that a final score equals the tip values of the pyramids a player holds,
and that 200 tied games are settled by a draw rather than by seat order.

## 2. Online hosting + bandwidth — all checks pass (`npm run e2e`)

Health endpoint, static pages, room-code format, bad-code and room-full
rejections, unique seat colors, and QR PNGs decoded with jsQR and verified to
contain the exact join URL. Then five complete AI games (2p, 3p, 4p) over
independent WebSocket connections.

Most recent run: 26–35 turns per game, every turn a word, **zero passes** —
confirming the 750 ms bot search budget does not degrade play. Traffic measured
at **~4.8 KB per turn, ~120–165 KB for a whole game**.

## 3. Browser suite — 45/45 checks (`node test/ui.js`)

Playwright, a desktop host screen and phone-sized player pages:

- home page, host QR lobby, phone joining via the scanned URL
- 3D board rendering: 100 cells, pyramid pieces, peak values, stack chips
- a full bot game to the Game Over overlay
- mid-game rejoin after a phone drops
- spelling glow preview and the hidden-scores rule
- game-over options, Main Menu freeing a seat, Play Again dealing a fresh
  board to everyone still connected, and the lobby fallback
- no turn countdown on either screen
- **host reconnect**: the host page is killed mid-game and reopened; the room,
  the board and the players all survive

Requires `npx playwright install chromium` locally; `test/ui.js` currently
hardcodes a Chromium path suited to the container it was written in.

## Not covered — read this before trusting the above

- **No human has ever played this game.** Every test player is scripted. These
  suites prove correctness, not that the game is fun or balanced.
- Several protocol-level edge cases are known and deliberately unfixed for now:
  no payload or rate limits, `again` has no phase guard, and a host socket that
  sends `join` can confuse its own role.
- Rooms live in memory: any restart ends every game in progress. Nothing tests
  restart behaviour because there is none to test.
- Two tabletop rules remain unimplemented by design — corner "bend" words and
  the challenge/forfeit flow. See the README.
- CI runs the unit and e2e suites on every pull request and push to main; the
  browser suite is still a local check.
