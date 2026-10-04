# Handoff — continuing Crossword Pyramids in a local session

Everything a fresh session needs to pick this up. Read this file first.

## How to start

A Claude Code session cannot be copied between machines, and a cloud session
cannot reach your computer — so this file is the handover. In a terminal, in
your clone of this repo:

```bash
git clone https://github.com/jubeii89-design/pyramids.git
cd pyramids && npm install
claude remote-control        # or open the folder in the Claude Desktop app
```

That session runs on your machine, so it has computer use and can drive the
Blender GUI. Point it at this file.

**The work is on the branch `claude/session-hsd67f`, open as draft PR #6.**
`main` does not have any of it. Check out that branch before doing anything.

---

## The game, in one paragraph

Node + Express + `ws`, no build step, vanilla JS front end. `server/game.js` is
a pure, unit-tested rules engine; `server/index.js` is the WebSocket server and
room lifecycle; `public/host.html` is the big screen, `public/play.html` the
phone controller, `public/board.js` the shared renderer. Rooms live in memory
in a `Map`, so **one instance only** — no autoscaling, and a restart ends every
game in progress. 359k-word dictionary in `data/words.txt`.

## Rules decisions made by the author this session

These override anything older in the README or in my earlier commit messages:

1. **Capture**: a played word's pyramids are picked up and the layer beneath is
   revealed. Letters may be taken from **any** of the four colours — that is
   the game, not an exploit. Every word still needs at least one black letter
   (a house pyramid or a printed square) in place.
2. **The Word Runway is optional space** — used only if a player uses it. Note
   the outermost ring is empty, so a word cannot be built there alone; it still
   needs a black letter in place somewhere.
3. **Scoring**: your score is the tip values of every pyramid you hold, added
   up, **minus the tips of your own colour still on the board**. The deduction
   is real and deliberate. (I removed it on an earlier reading and the author
   corrected me — do not remove it again.)
4. **Ties**: settled by a random draw — each tied player takes a pyramid from
   those still on the board, without replacement, highest tip wins, equal draws
   drawn again. Implemented as `drawOff()` in `server/game.js`; the result is
   on `state.tieBreak` and both results screens explain it.
5. **No turn clock.** A turn ends when the player plays a word or presses Pass.
   The only timer left skips the turn of a phone that has *disconnected*
   (`GONE_MS`, 30s).

## What is built and working

Host QR lobby, phone join, spelling with tap/swipe preview, AI opponents,
mid-game rejoin, host-screen reconnect, pyramid tracker, hidden scores until
the end, game over with Play Again / Main Menu, restart straight into a new
game, and the scoring above.

Tests: `npm test` (14 unit), `npm run e2e` (5 AI games over WebSockets),
`node test/ui.js` (Playwright, ~49 checks). CI runs the first two on every PR.
`node test/ui.js` hardcodes a container Chromium path at `test/ui.js:35` —
**change that locally** to your own Chromium or let Playwright find it.

## What is NOT done

- **Never deployed.** `crosswordpyramids.duckdns.org` resolves to DuckDNS's
  default, not to any AWS instance. Deploy steps are in `deploy/aws.md`.
- **No human has ever played it.** Every test player is a bot.
- Known and deliberately unfixed: no payload/rate limits, no room persistence
  across restarts, no corner "bend" words, no challenge/forfeit flow.

---

## The task in progress: Blender pyramid assets

**Goal:** replace the CSS fake-3D pyramids with pieces modelled in Blender —
white body, the **letter in the owner's colour**, the **tip value** on the peak
plate — for a better board and for animation. Author's decision: **pre-rendered
sprites**, not live three.js.

### The data

121 unique pieces: 26 letters × 4 colours, plus 17 distinct house letters.
Geometry is identical; only the glyph, its colour and the tip number vary.
Tip values, from `VALUES` in `server/game.js`:

```
1: a e i n o r s t u    2: d l    3: b c h m    4: f g
5: p y    6: k    7: j v w    8: x    9: q z
```

Palette, from `public/style.css`: red `#e0413c`, blue `#3f7fd6`,
green `#35a35a`, gold `#d99e1b`, house `#26242b`, body `--pyr-lite #fbfaf5`
through `--pyr-shadow #b3ac96`.

### Planned pipeline (not yet built)

1. `tools/export-piece-data.js` — Node, requires `server/game.js`, writes
   `tools/pieces.json`. Blender cannot read the JS, so this JSON is the
   handshake and keeps the models from drifting from the rules engine.
2. `tools/render-pyramids.py` — Blender headless
   (`blender --background --python`). One bevelled pyramid with a flat peak
   plate; per piece it sets the glyph, the glyph colour and the tip number and
   renders RGBA PNG at 256×256 to `build/pyramids/`. Camera should match the
   live board angle: `.board` is `rotateX(16deg)` under `perspective: 1100px`.
   Cycles on CPU is the reliable choice headless; EEVEE wants a GL context.
3. **Grunt** (author's choice) drives it: `grunt render`, `grunt sprites`
   (atlas + background-position CSS via `grunt-spritesmith`), `grunt assets` as
   the default. `devDependencies` only — the runtime stays `express`, `ws`,
   `qrcode`, and **built assets are committed** so the AWS box never needs
   Blender or Grunt.
4. `pyramidHTML()` in `public/board.js` swaps its four `clip-path` faces for a
   single sprite element. The `×N` stack chip stays DOM. `test/ui.js` asserts
   on `.pyr .peak` text today — that moves to the sprite's identity class,
   since the value becomes part of the image.

### Where computer use actually helps

Not for generating the assets — headless Blender does that and is
reproducible. It helps for **opening the generated `.blend` and tuning bevels,
lighting and materials by eye**, then re-running `grunt assets`.

### Scoped out deliberately

Sliding-piece animation. `renderBoard()` rebuilds all 100 cells with
`innerHTML = ''` on every update, so animating movement needs keyed DOM
reconciliation first. Sprites plus CSS transforms give lift/pop; true motion is
a separate piece of work.
