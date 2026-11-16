# Test report

What each gate **covers**, not a record of results. Everything below runs from
a clean clone with `npm ci`; no local files outside git are needed, and the
commands are the same in CI (`.github/workflows/ci.yml`).

| Gate | Command | What it covers |
|---|---|---|
| Unit and socket tests | `npm test` (14 files, serialized with `--test-concurrency=1`; the list is in package.json) | Rules engine: setup and layout, who goes first, word legality, capture and conservation, the uncovered-tops rule, both end conditions, scoring with the penalty (and the penalty now stored explicitly at game over, exposed as null during play, so the reveal can show it), the random-draw tie-break. Move previews and piece choices; dry-run/commit presentation parity; serialization leaking neither buried letters nor scores; hidden scores until the end; the pyramid tracker; the words log keeping a whole game (cap raised from 60 to 500); refusal hints never naming a control that no longer exists. Message validation; per-address limits; origin allow-list; credentialed reconnect; disconnect skip; `lift` and the private peek; the `draft` relay including its 50 ms burst drop, stale-revision drops and replay to a resumed host; feedback and `/health`; room checkpoint save/load and recovery; word-list content and reproducibility |
| Played games | `npm run e2e` (`node test/e2e.js 5`) | Five complete games (2, 3 and 4 players) over real WebSockets, played by scripted socket players; room code format, join URL and QR decode; fifth-player and bad-code rejection; game reaches game-over with a seated winner holding the top score; finals equal captured minus the explicit penalty for every player; largest WebSocket message under 64 KB; `/health` and every page serving |
| Browser: lobby and game | `node test/ui.js` (`npx grunt exec:ui`) | Home page, QR join, the lobby with the host's saved seat, the how-to dialog, a full game to the results screen, rejoin with the seat credential, tap letters into the word line, a refused word explained and left on the line to fix, scores hidden until the end (no digits on either screen during play), play again / main menu, host-screen reconnect. Newer ground: the opening board carries all four owner shapes, all different, at ≥10 px, and they are CSS-only — the score swatches hold no text; both viewport metas allow pinch-zoom; in landscape at 844×390 Submit is on screen at scroll 0 and cells clear the 24 px floor; the end-game reveal gives every player a captured − penalty = final row, stages the tie-break as drawn pyramids and highlights your own row on the phone; board cell nodes are reused across renders (keyed board) and played words animate on the TV |
| Browser: tap-to-build | `node test/tap-build.js` (`npx grunt exec:tap`) | The host seat link seats the host as red without a separate join and keeps the credential out of the address bar; flat tiles show letter, value and stack count; tapping a legal word lifts the stacks and fills the word line; the direction tap beside the black letter; removing one letter; Clear and a refused word restore every stack exactly; an accepted word lands in the words panel on phone and big screen; the host mirror glows the same squares as the phone and never shows an under-letter. Newer ground: every in-game control a thumb hits is measured at ≥44×44 (sound toggle, how-to, Clear, Submit, Pass, feedback button, word-line chips) while board cells are held to the 24 px AA floor with the smaller dimension binding; the feedback button does not sit over the board; tiles and the lobby swatch carry the owner shape on the phone too; no shape glyph enters the word line's text, and the chips' aria-labels name whose pyramid each letter came from; the refused word is an ordering of the same letters that the dictionary actually rejects |

## Running them

- `npx grunt verify` runs the first two gates, `npx grunt verify-ui` the two
  browser suites, and `npx grunt all` runs all four in one command.
- The browser suites drive Playwright's Chromium: `npx playwright install
  chromium` first.
- They are slow, and each prints its own verdict line. Read that text rather
  than the exit status of a pipeline: `npx grunt all 2>&1 | tee gate.log` keeps
  the whole trace, and piping a gate through `tail` without `pipefail` reports
  `tail`'s exit code, which once made a failing gate look clean. More of these
  lessons are recorded as conventions in `docs/ai-mindmap.yaml`.
- The most recent full-gate run recorded on this branch is the one quoted in
  commit `bb11020`'s message. Nothing in this file re-runs anything, so treat
  any pass as belonging to its run, not to this document.

## What is not covered

- No test has run on a real phone, on mobile data, or on a real AWS server.
  Nothing has been deployed.
- The sound cues are not exercised at all: the only assertion that touches them
  is the mute toggle's tap size. Web Audio is not driven headless, so a broken
  cue would pass the gate.
- Accessibility: no screen reader has read this app, in any suite or by hand,
  and no colour-blind player has seen the owner shapes. The suites now carry 24
  accessibility assertions — the live region exists, is polite, stays in the
  accessibility tree and receives a toast's text; a refusal is announced once
  rather than twice; exactly one board cell is in the tab order and the arrows
  carry it, clamping at the edges; Enter plays a square; cell labels name the
  player instead of the colour key; focus survives the word line being patched;
  a keyboard-focused button draws a ring; and the join box returns focus to its
  button rather than to the page body. Every one of those is a DOM proxy.
  Playwright contains no assistive technology, so the most they establish is
  that the node exists, that it is in the accessibility tree and that its text
  changed — never that anything is spoken. The shape checks likewise assert
  that a shape exists, is distinct and is CSS-only, not that anyone can use it.
  The host screen remains the thinnest of the three surfaces.
- The `svh` board sizing cannot be proven here: headless Chromium has no URL
  bar, so `svh`, `dvh` and `vh` measure identically. The suite shows no
  regression; only a real phone shows the fix.
- Link previews are unverified — `og:image` is a relative path until a deploy
  domain exists.
- The server never plays for anyone. Every "player" in these tests is a script
  that uses `findMove` from `server/game.js`; no human has played a full game
  under test, or at all.
- The HTTPS origin check has not been exercised behind a real reverse proxy.
- Load and soak testing are not done.
- Dependencies: the two advisories under Express (body-parser, qs) were fixed
  as a lockfile bump in commit `63727fa`; `npm audit` reflects whenever you
  last ran it, so run it rather than trusting this line.
- The word list is public-domain ENABLE plus a short house list of modern words and 144 reviewed words from Alan Beale's public-domain neol2016, with slurs removed; its content and reproducibility are locked in by `test/wordlist.test.js`. Whether it suits your audience (it is not a complete modern dictionary, and general profanity is allowed) is a product call.
