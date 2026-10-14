# Test report

Everything below runs from a clean clone of the repository with `npm ci`; no
local files outside git are needed. Commands are the same in CI.

| Gate | Command | What it covers |
|---|---|---|
| Unit and socket tests | `npm test` | Rules engine (setup, word legality, capture, scoring with the penalty, tie-break draw, end conditions); move previews and piece choices; resolver parity; message validation; per-address limits; origin allow-list; credentialed reconnect; disconnect skip; feedback and `/health`; room checkpoint save/load |
| Played games | `npm run e2e` | Five complete games (2, 3 and 4 players) over real WebSockets, played by scripted socket players; room code and QR decode; full-room and bad-code rejection; bandwidth per turn |
| Browser: lobby and game | `node test/ui.js` | Home, QR join, lobby with the host's saved seat, a full game to the results screen, rejoin with the seat credential, tap letters into the word line, a refused word explained and cleared, scores hidden until the end, play again / main menu, host-screen reconnect |
| Browser: tap-to-build | `node test/tap-build.js` | Host seat link seats the host as red; flat tiles show letter, value and stack count; tapping a legal word lifts the stacks and fills the word line; removing one letter; Clear and a refused word restore every stack exactly; an accepted word lands in the words panel on phone and big screen |

`npx grunt verify` runs the first two; `npx grunt verify-ui` runs the two
browser suites (they need Playwright's Chromium: `npx playwright install chromium`).

## What is not covered

- No test has run on a real phone, on mobile data, or on a real AWS server.
- The server never plays for anyone. Every "player" in these tests is a script
  that uses `findMove` from `server/game.js`; no human has played a full game
  under test.
- The HTTPS origin check has not been exercised behind a real reverse proxy.
- Load, soak and accessibility testing are not done.
- The word list is public-domain ENABLE plus a short house list of modern words and 144 reviewed words from Alan Beale's public-domain neol2016, with slurs removed; its content and reproducibility are locked in by `test/wordlist.test.js`. Whether it suits your audience (it is not a complete modern dictionary, and general profanity is allowed) is a product call.
