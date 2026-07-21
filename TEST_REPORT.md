# Crossword Pyramids — Pre-Release Test Report (v2: 3D Visual Update)

**Date:** 2026-07-21 · **Verdict: PASS — ready for release review**

This release adds the fun-3D visual style (Jackbox-inspired UI) on top of the
v1 engine: real pyramid pieces with letters, peak values, stack tracking, and
the Red / Blue / Green / Gold color system. All test layers were re-run and
pass: 11/11 unit tests, the online-hosting e2e suite with bandwidth
measurement (room codes, QR decode, 5 complete AI games), and the Playwright
browser suite (22/22 checks) covering the host screen and the phone side.

## What changed in v2

- **3D pyramid pieces**: every piece renders as a four-faced pyramid with
  directional shading, a **peak plate showing the tip point value**, and the
  letter on the front face — white bodies with letters colored by owner
  (Red, Blue, Green, **Gold**), black-bodied house pyramids, matching the
  physical set. Board is perspective-tilted with hover/selection pop.
- **Stack tracking system**: every stack shows an **×N depth chip**, and a
  **Pyramid Tracker** panel (host sidebar + phone) shows exactly how many
  pyramids of each color remain on the board (n/30 per color, n/36 house)
  with live progress bars — players always know what remains after letters
  are taken. Server now broadcasts per-color remaining + captured counts.
- **Jackbox-style look**: vibrant purple stage backdrop, chunky 3D buttons,
  animated hero pieces, toasts; Strategic Titans badge on the home page.
- Same infrastructure, rules engine, rooms, and protocol as v1.

## 1. Rules engine unit tests — 11/11 pass (`npm test`)

All v1 tests (setup, turn order, rejections, stealing constraints,
conservation, uncovered rule, endings, scoring, serialization) plus a new
tracker test: remaining counts start at 30/30/30/30 + 36 house and drop by
exactly the number of captured pyramids after each word, with captured
counts per owner agreeing.

## 2. Online hosting e2e + bandwidth — ALL CHECKS PASSED (`npm run e2e`)

Room-code format, bad-code rejection, room-full rejection, unique seat
colors, and QR PNGs decoded and verified to contain the exact join URL —
5/5 rooms. Five full AI games over independent WebSocket connections:

| Game | Players | Winner | Turns | Words | Total to host | Per turn | Largest msg |
|------|---------|--------|-------|-------|---------------|----------|-------------|
| 1 | 2 | red | 32 | 32 | 153.6 KB | 4.80 KB | 4.61 KB |
| 2 | 3 | red | 19 | 19 | 99.3 KB | 5.23 KB | 4.66 KB |
| 3 | 4 | green | 37 | 37 | 186.1 KB | 5.03 KB | 4.78 KB |
| 4 | 2 | red | 27 | 27 | 131.0 KB | 4.85 KB | 4.51 KB |
| 5 | 3 | green | 30 | 30 | 149.6 KB | 4.99 KB | 4.67 KB |

**Bandwidth verdict:** a complete game costs ~100–190 KB per connected
screen (~5 KB per turn; largest single message under 5 KB, asserted < 64 KB).
Phones receive the same stream — comfortably fine on any cellular
connection; a 4-player party uses well under 1 MB total per game. Static
page weight is also light (no frameworks, no build, one QR data-URL).

Every game reached a legitimate game-over, winners always held the top
score, and zero bot moves were rejected by the server.

## 3. Browser UI tests (phone side included) — 22/22 PASSED (`node test/ui.js`)

- Home page: title, marketing panels, Host/Join, join-code box
- Host: room code + QR + join URL; lobby updates as players join/leave
- Phone: QR link pre-fills the room code; joined as "Cleo", seated Red
- 3D verification on the live board: 100 cells, 60+ pyramid pieces rendered,
  **peak value plates visible**, **20+ stack ×N chips**, tracker showing
  4 colors + House with **Gold** naming
- Full game played to the Game Over overlay on the big screen
- Phone side in-game: 100-cell 3D board, pyramid tracker, controls
- Mid-game disconnect + rejoin by name recovers the seat and live board

Fresh screenshots in `screenshots/`.

## Bugs found and fixed during this round

1. **UI test race on the room code** — the "…" placeholder is also 4
   characters, so a fast check could read it before the server's room code
   arrived. The wait now matches `/^[A-Z]{4}$/`.
2. **Case-sensitive color check** broke when player-facing color names were
   capitalized (Red/Gold); test updated, and all player-facing text now uses
   the display names consistently (yellow → **Gold**).

## Known limitations (unchanged from v1, plus)

- Runway corner "bends" not implemented (straight words only)
- Dictionary replaces the challenge flow; rooms are in-memory
- The 3D is stylized CSS (four shaded faces + peak plate), not a WebGL
  engine — chosen deliberately so phones stay fast, taps stay precise, and
  nothing needs a loading screen. A Three.js host-screen view is a possible
  future upgrade.
- Music/SFX intentionally deferred per plan.

## Release recommendation

Ship it. The 3D presentation, stack tracking, and party UI are verified on
both the big screen and the phone side, bandwidth is negligible, and the
engine remains stable across all five test games.
