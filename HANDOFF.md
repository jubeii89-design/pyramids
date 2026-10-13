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
  `public/board.js` shared helpers + DOM fallback board, `public/board-3d.js`
  the three.js board.
- `tools/` + `Gruntfile.js` - Blender sprite pipeline (`npx grunt assets`);
  built art in `public/assets` is committed, so the server needs neither
  Blender nor Grunt.
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

## Operations notes

- One server instance only. Rooms are checkpointed to `ROOM_STORE_PATH` so a
  process restart on the same disk recovers them; that is not a backup.
- Production requires `PUBLIC_ORIGIN`; behind a proxy set `TRUST_PROXY=1`.
- Optional: `TIP_URL` (https, shown only after a game), `FEEDBACK_PATH`.

## Not done

- Never deployed; no human has played a full game under test.
- Rights to the name, rules text and art are unconfirmed; written permission
  is needed before anything public or paid. Nothing paid is built.
- Sound, tutorial, accessibility pass, graceful shutdown. (The word list is now ENABLE; see `data/WORDLIST.md`.)
- See `IMPROVEMENT-PLAN.md` / `PUBLIC-READINESS-REVIEW.md` if present locally.
