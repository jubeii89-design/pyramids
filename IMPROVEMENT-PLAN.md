# Crossword Pyramids — Improvement Plan

A design pass over the whole product: what is genuinely good, what is honestly
weak, and how I would make this a game people ask to play again — without
touching a single rule. The machine-readable companion is
[`docs/ai-mindmap.yaml`](docs/ai-mindmap.yaml): every rule, number, protocol
message, known issue and plan item below exists there as a structured node an
AI session can be pointed at ("do M1-03").

Evidence discipline: every factual claim here carries a `file:line` reference
or lives in the mind map with one. Anything without a reference is a design
judgment and is written as one.

---

## 1. Honest assessment

### What is genuinely strong

- **The rules engine is real.** `server/game.js` is a pure, I/O-free rules
  module with stable refusal codes, a dry-run planner, and a presentation
  trace for every word. Fourteen test files, a scripted five-game e2e, and two
  Playwright browser suites run green in CI. Most hobby party games never get
  this skeleton.
- **Live draft mirroring** (`draft` relay, server/index.js:365-381): everyone
  watches the current player's word form letter by letter, with under-letters
  never leaked. This is the game's best "together in one room" feature and the
  foundation for most of what M3 proposes.
- **Structured refusals** (game.js `refuse()`): every illegal play says *why*
  with a stable code and a hint. Most games just say "no".
- **Resilience is designed, not accidental**: credentialed seat reclaim,
  10-minute host grace, atomic restart checkpoint, origin allow-list, rate
  limits. A game night survives a sleeping laptop and a dropped phone.
- **Tap-to-build with private lift**: spelling by tapping real pieces, peeking
  under a lifted top that only you can see — this is tactile and already
  closer to the physical game than typing a word ever was.

### What has since been delivered

The weaknesses this plan was written against have been built out. All thirteen
known issues in the mind map (KI-01..KI-13) now carry a fixed status, and M1,
M2 and part of M4 have landed. The evidence, in the order the original
complaints appeared:

- **The show exists.** `animatePlay` (public/board.js:380) replays
  `presentation.steps` on the TV on top of a keyed renderer whose cell nodes
  survive a state update (public/board.js:209), both asserted in the browser
  (test/ui.js:181,183).
- **Phones keep their screens.** `requestWakeLock()` (public/play.html:292)
  takes a real screen wake lock, and `alertMyTurn()` buzzes and flashes the tab
  title when your turn arrives on a hidden tab (play.html:298-303).
- **The celebration is no longer undercut.** A `pendingSubmit` flag suppresses
  the board-changed toast for your own accepted word (public/play.html:155,389).
- **One rules voice.** The home dialog (public/index.html:157) and the README
  (README.md:42-45) now describe tap-to-build, and a unit test holds the line
  that no refusal hint names a removed control (test/unit.test.js:335).
- **The TV reads from a couch.** `.boardwrap` is a size container and the tile
  clamps are `cqw`, so tile text follows the board rather than the viewport
  (public/style.css:95,207-217); the host's private seat QR sits behind a "Show
  my seat code" button (public/host.html:76); the words log cap went to 500
  (server/game.js:10).
- **The end-game maths is shown.** The server stores the deduction at game over
  and serializes it, null during play (server/game.js:411-417,528), and both
  screens spell out captured − own colour left on board = final with the
  tie-break staged as drawn pyramids (public/board.js:39-95, host.html:325-326,
  play.html:569; asserted at test/ui.js:355-358, test/e2e.js:194,
  test/unit.test.js:182,244).
- **Sound.** Five cues synthesized with Web Audio oscillators and no audio
  files anywhere, so nothing needs a licence (public/sounds.js:46-77,
  provenance in public/assets/SOUNDS.md); mute persists per device
  (sounds.js:10-12) and every path fails silent under the autoplay lock
  (sounds.js:79-88).
- **Ergonomics.** `maximum-scale` is gone from the phone viewport
  (public/play.html:5), the in-game controls measure ≥44×44 in a browser
  (test/tap-build.js:88-106), and landscape — which had no orientation query at
  all — is a two-column grid sized in `svh` (public/play.html:52-69).
- **Colour is no longer the only signal.** Each owner carries a shape as well
  as a hue, as a CSS `::after` that never enters `textContent`
  (public/style.css:238-247,332-341,454-458; asserted at
  test/ui.js:123,135 and test/tap-build.js:121,123,245).

### What is honestly weak

- **Nobody has played it.** Never deployed; zero human playtests
  (docs/ai-mindmap.yaml:168, HANDOFF.md "Not done"). Everything below is still
  theory until one game night happens. That remains the single most important
  fact about this project.
- **Unresolved rights.** The name, rules text and art provenance are
  unconfirmed (HANDOFF.md). No amount of code fixes this; it gates anything
  public or paid.
- **Accessibility is a complete pass in code and an unverified one in fact.**
  M4-01 is finished (docs/ai-mindmap.yaml:325): the ergonomic and colour half,
  then semantics, keyboard and focus. The sound toggle's `aria-pressed` and
  `aria-label` are applied at runtime (public/sounds.js:95-96), and the host
  screen is still the thinnest of the three surfaces. My judgment: the owner
  shapes and the live region are the structurally right fixes, but no screen
  reader has read this app aloud and no colour-blind player has seen the
  shapes, so none of it is verified where it counts - and a DOM assertion in a
  headless browser cannot stand in for either.
- **Nothing has been seen on real hardware.** The landscape and `svh` work was
  measured in headless Chromium, which has no URL bar, so `svh`, `dvh` and `vh`
  measure identically there: the suite proves no regression and cannot prove
  the fix (docs/ai-mindmap.yaml:168,371). A real phone is the only evidence
  that will do.
- **The sound layer is untested as sound.** The only assertion that touches it
  is the toggle's tap size (test/tap-build.js:98) — Web Audio is not exercised
  headless. Design judgment: acceptable for cues that fail silent by
  construction, but a broken cue would ship unnoticed.
- **The front door is shareable but not yet linkable.** `og:image` is a
  relative path on purpose, because no deploy domain exists
  (public/index.html:14-16) — so the link-preview card cannot actually be
  checked until there is somewhere to deploy.
- **Waiting players still only watch.** M3 is untouched: both of its items are
  in the mind map with no status (docs/ai-mindmap.yaml:311-318). The draft
  mirror makes waiting watchable, which is the floor, not the ceiling.
- **The draft relay still fails quietly.** It returns on a turn, gameId or
  revision mismatch, on a 50 ms per-socket throttle and on a 200-per-10s
  per-address limit, and nothing is re-sent (server/index.js:365-381), so a
  starved mirror stays stale until the player touches the board again. KI-13
  closed as a test-harness bug; this server half is unchanged, and three or
  more games behind one address would cross the limit (docs/ai-mindmap.yaml:223).

## 2. Locked constraints

The game rules are **immutable**: board, pieces and values, legality, capture,
hidden-until-end scoring, the leftover-colour **penalty** (deliberate — do not
remove), both endings, the random-draw tie-break, and **no turn clock**. The
single structured source is the `rules` block of `docs/ai-mindmap.yaml`
(every node `locked: true`, every number mechanically verified against
`server/game.js`). Standing author decisions also hold: humans only (2-4),
vanilla JS with no build step, one server instance, the word-list licensing
bar (data/WORDLIST.md).

## 3. How I'd do it better — five pillars

1. **The TV is a stage, not a web page.** Everything on the host screen must
   read from a couch and *react* — a word being played should be an event you
   watch, not a diff you infer.
2. **Nobody waits bored.** With no turn clock (locked), spectator engagement
   is the game's biggest design obligation. The draft mirror already makes
   waiting watchable; build on it until waiting is *part of the game*.
3. **Phones never die.** Wake lock, your-turn alerts, visible reconnection.
   A party game that skips you because your screen dimmed has failed at its
   only job.
4. **Every steal is a moment.** Taking an opponent's letter is this game's
   signature act. The data to stage it already ships with every word
   (`presentation.steps`); rendering it is the single highest-leverage change
   in the codebase.
5. **One truthful voice.** One rules source, in-character copy, and no hint
   that points at a control that doesn't exist.

## 4. The plan

Full per-item detail — problem, evidence, acceptance criteria, size,
dependencies — lives in `improvement_tree` of the mind map with stable IDs.
Summary:

### M1 — Game-night safe (P0, all small) — **delivered**
The gate at the end of M1 is **one real game night with humans**, and that gate
is still unmet: the code is done, the game night has not happened. Nothing in
M2+ was worth building before it; some of it was built anyway, which is a risk
this plan should name rather than hide.

| ID | Item | Status |
|---|---|---|
| M1-01 | Screen Wake Lock + your-turn vibration/title flash | delivered |
| M1-02 | Clear the build on Submit — kill the celebration-undercutting toast | delivered |
| M1-03 | Rewrite refusal hints for tap-to-build; keep the word on refusal | delivered |
| M1-04 | Fix join dead-ends (ROOM_GONE hides the code field; name collisions) | delivered |
| M1-05 | Take the host's private seat QR off the shared TV | delivered |
| M1-06 | Visible "Reconnecting…"; make passes visible; stalemate warning | delivered |
| M1-07 | Retire the two stale rules texts in favour of HOWTO_STEPS | delivered |
| M1-08 | Lift the 60-entry words-log cap that corrupts long-game recaps | delivered |

### M2 — The show (P1) — **delivered**

| ID | Item | Status |
|---|---|---|
| M2-01 | Keyed-DOM board renderer (tech enabler for any animation) | delivered — public/board.js:209 |
| M2-02 | Animate `presentation.steps`: pieces fly, steals named | delivered — public/board.js:380 |
| M2-03 | TV layout pass, tiles readable at 3 m | delivered — public/style.css:95,207-217 |
| M2-04 | Sound, with licences documented like the word list | delivered — public/sounds.js, nothing to license |
| M2-05 | End-game reveal: *visibly* subtract the penalty, stage the tie-break | delivered — public/board.js:39-95 |
| M2-06 | Atmosphere: the real sky behind the board | delivered — public/style.css:26-29,36-60 |

Design judgment on M2-04: synthesizing the cues instead of sourcing CC0 files
was the right trade. It satisfies the licensing bar by having nothing to
license, at the cost of cues that are plain by construction. If a playtest says
the game sounds thin, that is the moment to buy or record, not before.

### M3 — Everyone plays (P2) — **open, untouched**
Waiting-player engagement on top of the draft mirror (emoji reactions on the
TV, a one-tap "will it land?" prediction); lobby identity (avatars, VIP
start-from-phone via the existing host seat, kick). Both items sit in the mind
map with no status (docs/ai-mindmap.yaml:311-318). My judgment: this milestone
should not start until a real table has shown whether waiting is actually the
problem — it is the item in this plan most likely to be wrong.

### M4 — Reach everyone (P3) — **partly delivered**

| ID | Item | Status |
|---|---|---|
| M4-01 | Ergonomics + accessibility | **delivered** — targets, pinch-zoom, landscape, owner shapes, then semantics, keyboard and focus (docs/ai-mindmap.yaml:325); unverified by a real screen reader |
| M4-02 | Copy/tone pass: one in-character string table | open |
| M4-03 | Board magnify/pan so cells can reach the AAA 44 px bar | open — split out of M4-01 (docs/ai-mindmap.yaml:330-334) |
| M4-04 | Deuteranope palette study on top of the shapes | open — split out of M4-01 (docs/ai-mindmap.yaml:335-339) |

M4-01's acceptance was restated when it landed, and the restatement matters:
"≥44 px taps" cannot hold for board cells (ten across a 390 px phone is 32 px
by arithmetic), so cells are held to the 24 px WCAG 2.2 SC 2.5.8 AA floor and
measured in a browser, in portrait and landscape, while the phone's in-game
controls are measured at 44×44 one by one (test/tap-build.js:88-106,
test/ui.js:249-250). Only the controls the suite names are measured. The
44 px figure is SC 2.5.5, AAA — M4-03's bar, not this one's.

## 5. What I would NOT do

- **No framework or build-step rewrite.** Vanilla JS is a decision, and it is
  the right one at this size.
- **No accounts, no database, no multi-instance scaling.** A party game with
  4-player rooms and a 200-room cap does not need them.
- **No audience mode in v1.** Tempting, out of scope; listed so nobody
  re-proposes it.
- **No AI opponents** (author decision) and **no monetization** beyond the
  existing optional tip link.
- And the two gates no code can clear: the **rights question** and the
  **zero-playtests fact**. The first real milestone after M1 is a table of
  humans, a TV, and the feedback button.

## 6. Verification

- Per-item acceptance criteria are in the mind map (`improvement_tree`).
- The existing harnesses carry most of it, and `npx grunt all` is now the whole
  gate in one command: unit (`npm test`, 14 serialized files — package.json:11),
  network (`node test/e2e.js 5`), then the two Playwright suites, `test/ui.js`
  and `test/tap-build.js` (Gruntfile.js:13-15). `TEST_REPORT.md` lists what each
  one covers. CI splits the same commands across two jobs
  (.github/workflows/ci.yml).
- Everything delivered above carries assertions in that gate; the one exception
  is sound, where only the toggle's tap size is checked (test/tap-build.js:98).
- The hard-won lessons about *how* to verify are recorded as conventions in the
  mind map (docs/ai-mindmap.yaml:358-375) — measure layout in a browser rather
  than on paper, never pipe a gate through `tail` without `pipefail`, a test
  must fail rather than abort. They exist because each mistake was made once
  here; re-read them before adding a gate.
- Physical checklist for the M1 gate: two phones (one iOS, one Android), a TV
  at 3 m, one full game with a forced disconnect/reclaim, one Play Again, one
  stalemate ending — and the feedback log read afterwards.
