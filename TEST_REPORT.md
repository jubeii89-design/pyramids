# Test report

Everything below runs from a clean clone of the repository with `npm ci`; no
local files outside git are needed. Commands are the same in CI.

| Gate | Command | What it covers |
|---|---|---|
| Unit and socket tests | `npm test` (65 tests) | Rules engine (setup, word legality, capture, scoring with the penalty, tie-break draw, end conditions); move previews and piece choices; resolver parity; message validation; per-address limits; origin allow-list; credentialed reconnect; disconnect skip; feedback and `/health`; room checkpoint save/load |
| Played games | `npm run e2e` | Five complete games (2, 3 and 4 players) over real WebSockets, played by scripted socket players; room code and QR decode; full-room and bad-code rejection; bandwidth per turn |
| Browser: DOM board | `node test/ui.js` | Home, QR join, lobby, a full game to the results screen, rejoin with the seat credential, spelling preview, scores hidden until the end, play again / main menu, host-screen reconnect |
| Browser: 3D board | `node test/visual-3d.js` | Real WebGL board, mobile layout, inert player names, draft undo, atomic submit, capture animation |
| Browser: piece choice | `node test/pick-pieces.js` | Chooses an alternative source piece and checks exactly the previewed pieces were captured |

`npx grunt verify` runs the first two; `npx grunt verify-ui` runs the three
browser suites (they need Playwright's Chromium: `npx playwright install chromium`).

## What is not covered

- No test has run on a real phone, on mobile data, or on a real AWS server.
- The server never plays for anyone. Every "player" in these tests is a script
  that uses `findMove` from `server/game.js`; no human has played a full game
  under test.
- The HTTPS origin check has not been exercised behind a real reverse proxy.
- Load, soak and accessibility testing are not done.
- The word list is ENABLE (public domain); its quality is locked in by `test/wordlist.test.js`, but whether it suits your audience (for example, newer words) is a product call.
