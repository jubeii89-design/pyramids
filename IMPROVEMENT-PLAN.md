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

### What is honestly weak

- **Nobody has played it.** Never deployed; no human has completed a full game
  (HANDOFF.md "Not done"). Everything below is theory until one game night
  happens. That is the single most important fact about this project.
- **The show doesn't exist yet.** The server narrates every word as a
  step-by-step `presentation` (game.js:307-315, broadcast at
  server/index.js:390) and **no client renders it** — pieces teleport, steals
  go unannounced, the board just blinks into its next state. The best material
  in the codebase is being thrown away on arrival.
- **Phones will die mid-game.** `keepAwake()` (public/board.js:140-142) pings
  the server; it does not keep the *screen* awake. A phone that sleeps drops
  its socket and gets skipped after 30 s — at a real table this will happen in
  the first ten minutes.
- **The game undercuts its own best moment.** Submitting a word leaves the
  local build list populated (public/play.html:495-500), so the very next
  state broadcast toasts *"The board changed - your word was cleared."*
  (play.html:317) on top of *"You spelled X!"* — the player's reward reads
  like an error.
- **Three voices tell the rules, two of them wrongly.** The home-page dialog
  (public/index.html:146-151) and README (README.md:42-48) still describe the
  removed type-a-word flow; refusal hints still say "Press Auto" and
  "highlighted pieces" (game.js:193,226,232,286) — controls that don't exist.
  Only `HOWTO_STEPS` (board.js:77-84) is current.
- **The TV is a web page, not a stage.** Tile values and stack counts bottom
  out at 7 px (public/style.css:167-173,214-221); the host's *private* seat QR
  renders on the shared screen where anyone can scan it and take the seat
  (host.html:54-55); nothing on the screen reacts to events.
- **Unresolved rights.** The name, rules text and art provenance are
  unconfirmed (HANDOFF.md). No amount of code fixes this; it gates anything
  public or paid.

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

### M1 — Game-night safe (P0, all small)
The gate at the end of M1 is **one real game night with humans**. Nothing in
M2+ is worth building before that.

| ID | Item |
|---|---|
| M1-01 | Screen Wake Lock + your-turn vibration/title flash |
| M1-02 | Clear the build on Submit — kill the celebration-undercutting toast |
| M1-03 | Rewrite refusal hints for tap-to-build; keep the word on refusal |
| M1-04 | Fix join dead-ends (ROOM_GONE hides the code field; name collisions) |
| M1-05 | Take the host's private seat QR off the shared TV |
| M1-06 | Visible "Reconnecting…"; make passes visible; stalemate warning |
| M1-07 | Retire the two stale rules texts in favour of HOWTO_STEPS |
| M1-08 | Lift the 60-entry words-log cap that corrupts long-game recaps |

### M2 — The show (P1)
M2-01 keyed-DOM board renderer (tech enabler — board.js:159 rebuilds all 100
cells with innerHTML per state, blocking all animation) → M2-02 **animate
`presentation.steps`** (pieces fly, steals named, capture piles grow) →
M2-03 TV layout pass (readable at 3 m) → M2-04 sound with documented licences
→ M2-05 the end-game reveal: count captures up, *visibly* subtract the
leftover-colour penalty (today the maths is never shown and players will ask
"why 12?"), stage the tie-break as drawn pyramids.

### M3 — Everyone plays (P2)
Waiting-player engagement on top of the draft mirror (emoji reactions on the
TV, a one-tap "will it land?" prediction); lobby identity (avatars, VIP
start-from-phone via the existing host seat, kick).

### M4 — Reach everyone (P3)
≥44 px tap targets, re-enable pinch zoom, colour-blind-safe palette with owner
glyphs (colour never the only signal), aria labels with display names,
landscape, focus retention; one in-character string table.

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
- The existing harnesses carry most of it: `npm test` (14 serialized suites),
  `node test/e2e.js 5`, `npx grunt verify-ui` (Playwright: lobby, full game,
  tap-to-build). M1 items each get a test in the suite that already covers
  their surface; M2-01 must pass the existing browser suites unchanged.
- Physical checklist for the M1 gate: two phones (one iOS, one Android), a TV
  at 3 m, one full game with a forced disconnect/reclaim, one Play Again, one
  stalemate ending — and the feedback log read afterwards.
