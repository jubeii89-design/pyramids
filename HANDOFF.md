# Handoff - Crossword Pyramids

Current state of the project, for whoever picks it up next. The code is the
source of truth; this file only records decisions and where things are.

## Where things are

- `server/game.js` - pure rules engine (no I/O). `findMove` is a move-search
  helper used only by tests; the server never plays for anyone.
- `server/index.js` - WebSocket server and room lifecycle, with `validate.js`
  (message shapes), `limits.js` (per-address limits), `origin.js` (allowed
  browser origins), `security.js` (credentials), `room-store.js` (restart
  checkpoint file).
- `public/host.html` big screen, `public/play.html` phone controller,
  `public/board.js` shared helpers and the flat board (letter centred, tip
  value top-left, stack count bottom-right, owner shape top-right). The board
  is flat: the old three.js and Blender sprite pipeline were removed (they are
  in git history). `board.js` also holds the keyed renderer (the 100 cell nodes
  are made once and rebuilt only when a per-cell signature changes,
  `board.js:209`), `animatePlay`, which replays `presentation.steps` on the TV
  (`board.js:380`), and the end-game reveal both screens share
  (`finalsRevealHTML`, `tieBreakStageHTML`, `animateFinalsReveal`,
  `board.js:39-95`).
- `public/sounds.js` - a new client file, loaded by both the host and the phone.
  Five cues (join, your turn, word played, steal, game over) are synthesized at
  play time with Web Audio oscillators: there are no audio files anywhere in
  the project, so there is nothing to license (note in
  `public/assets/SOUNDS.md`). A page opts in with the script tag plus any
  `[data-sound-toggle]` button; mute is per device (`localStorage` key
  `cp_muted`) and every path fails silent while the browser's autoplay lock
  holds, so a TV nobody touches is simply quiet rather than broken.
- `public/assets/` - the Milky Way background, the favicon and apple-touch
  icon, and the link-preview image, with provenance in `ASSETS.md` and
  `SOUNDS.md`; `public/credits.html` carries the credits.
- Building a word on a phone: tap letters in spelling order; the first black
  letter fixes where the word sits. The direction comes from the neighbour tap:
  tap the square beside the black letter (right or below = Across or Down; left
  or above also, with the black letter then inside the word). Default is Across,
  or Down if Across would run off the board. Nothing is played until Submit, so
  Clear or a refusal just forgets the local list. `lift` (server) shows the
  piece under a lifted top to the player on turn only, and never changes state.
  `draft` mirrors the word live: the player on turn sends
  `{type:'draft', gameId, revision, dir, items:[{r,c}]}` (squares in spelling
  order, empty array = cleared); the server derives public letters and relays
  `{type:'draft', color, items:[{r,c,l,b}], start, lifted}` to the host and the
  other players. Under-letters are never sent. It is memory only (not in the
  room store), rate limited, ignored when stale, cleared when the owner leaves
  or the board changes, and replayed after each state broadcast.
- The host gets a reserved seat on `host_create` and a one-time link
  (`play.html?room=CODE#seat=TOKEN`) for their own phone; an unclaimed seat is
  dropped at Start (or yields to a fourth guest).
- `deploy/` and `README.md` - running it (Lightsail steps, environment variables).
- Check which build is live: `curl https://your-domain/health` returns `build`
  (commit) and `startedAt`.

## Rules decisions made by the author

These override anything older:

1. **Capture**: a played word's pyramids are picked up and the layer beneath is
   revealed. Letters may be taken from any of the four colours. Every word
   still needs at least one black letter (house pyramid or printed square) in
   place, one of your own pyramids, and at least one moved pyramid.
2. **The Word Runway is optional space**; the outermost ring is empty.
3. **Scoring**: your score is the tip values of every pyramid you hold, minus
   the tips of your own colour still on the board. The deduction is deliberate;
   do not remove it.
4. **Ties** are settled by a random draw (`drawOff()` in `server/game.js`), and
   both results screens explain it.
5. **No turn clock.** The only timer skips the turn of a phone that has
   disconnected (`GONE_MS`, 30 s); a skipped turn counts as a pass.
6. **Humans only**: 2-4 players, no computer players.
7. Scores stay hidden until the game ends; the recap appears then.

## Presentation decisions made by the author

Newer than the rules list above, and equally binding:

1. **The sky shows.** Every background darkening sits at 20% - the page wash
   and vignette (`public/style.css:26-29`) and the host's Game Over scrim
   (`public/host.html:28`). Mid-game dialog backdrops stay dark on purpose:
   they are focus modals, not background treatment (`style.css:97,115`,
   `index.html:68`). Tuning is judged by eye from screenshots.
2. **Colour is never the only signal.** Each owner carries a shape as well as a
   hue - Red circle, Blue square, Green diamond, Gold star - drawn as a CSS
   `::after` (`style.css:238-247`, word-line and lobby chips `332-341`, flying
   tiles `454-458`), so identity survives greyscale and no glyph ever enters
   `textContent`, which several suites depend on. The triangle is reserved for
   whose turn it is (`host.html:34`, `play.html:36`) - do not reuse it. The
   four hues are deliberately unchanged, because they are player-facing names;
   a deuteranope retune is its own plan item (M4-04).
3. **Sound is synthesized, never recorded**, so no audio file ever needs a
   licence.
4. **The phone board is sized in `svh`, never `dvh`** (`play.html:61`): the
   dynamic viewport grows as the URL bar hides, which resized the board under
   a player's thumb mid-word. `vh` stays only as the legacy fallback.
5. **Tile text follows the board, not the viewport**: `.boardwrap` is a size
   container and the tile clamps are in `cqw` (`style.css:95,207-217`), with
   the old `vmin` clamps kept underneath as the fallback.
6. **The end-game maths is shown, not merely applied**: both screens spell out
   captured - your own colour left on board = final, and a tie is staged as the
   pyramids each tied player drew (`server/game.js:411-417` stores the
   deduction, `:528` serializes it, null during play).
7. **Pinch-zoom stays on** (`play.html:5` carries no `maximum-scale`), and
   board cells stay at the WCAG 2.2 AA floor of 24px rather than growing to
   44px, which would fight the board's aspect ratio; a magnify/pan mode is a
   separate item (M4-03). Measure such things in a browser, never on paper.

## Operations notes

- One server instance only. Rooms are checkpointed to `ROOM_STORE_PATH` so a
  process restart on the same disk recovers them; that is not a backup.
- Production requires `PUBLIC_ORIGIN`; behind a proxy set `TRUST_PROXY=1`.
- Optional: `TIP_URL` (https, shown only after a game), `FEEDBACK_PATH`.
- Link previews carry a relative `og:image` (`public/index.html:16`,
  `public/play.html:14`); it resolves only once there is a real deploy domain.

## Not done

- Never deployed, not once. Zero human playtests: no human has played a full
  game, under test or otherwise. That is still the most important fact here.
- Rights: the author confirmed on 2026-11-19 that the name, rules text and
  art are theirs, so rights no longer gate a public or paid release. Nothing
  paid is built. A human beta test is planned for the days after that date.
- Every known issue in `docs/ai-mindmap.yaml` (KI-01..KI-13) is closed. KI-13
  had left a residue in the server, and that half is now fixed too: the draft
  relay's 50 ms per-socket throttle dropped the newest draft of a burst and sent
  nothing after it, so the TV mirrored a half-spelled word for the rest of the
  turn. It is deleted - the phone debounces at 120 ms and every socket is capped
  at 40 messages a second, so nothing needed it. The 200-per-10s per-address
  limit remains and still never re-sends, so three or more games behind one
  address could leave each other's mirrors stale. That is the open half.
- The accessibility pass (M4-01) is complete in code: tap targets, pinch-zoom,
  landscape and the owner shapes, then the semantics, keyboard and focus third
  - a polite live region so toasts are announced, cell labels that name the
  player rather than the colour key, one roving tab stop with arrow keys instead
  of a hundred, visible focus rings, and a word line patched in place so focus
  survives a letter landing. What is NOT done is the verification that counts:
  nothing has been heard in VoiceOver or TalkBack, and no colour-blind player
  has seen the shapes. Playwright contains no assistive technology, so every
  assertion in the suite is a DOM proxy - the node exists, it is in the
  accessibility tree, its text changed - and none of it is evidence that a
  screen reader speaks a word of it. The host screen remains the thinnest of
  the three surfaces.
- Tutorial beyond the how-to dialog, graceful shutdown. (Sound is done now -
  see `public/sounds.js`.)
- (The word list is public-domain ENABLE plus our own short modern-words file and reviewed words from Alan Beale's public-domain neol2016, with slurs removed; see `data/WORDLIST.md` and `tools/build-wordlist.js`. A wider modern vocabulary needs a source whose licence you have checked.)
- See `IMPROVEMENT-PLAN.md` (design plan, in the repo) and `docs/ai-mindmap.yaml`
  (its machine-readable companion: locked rules, protocol, known issues, plan
  items with stable IDs). `PUBLIC-READINESS-REVIEW.md` exists only locally, if at all.
