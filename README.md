# Crossword Pyramids — Spell to Win!

A Jackbox-style online party version of the Crossword Pyramids board game.
Host the game on a big screen; players join from their phones by scanning a
QR code or entering a 4-letter room code.

## Quick start

```bash
npm install
npm start          # serves on http://localhost:3000
```

- Open `/` for the marketing home page → **Host Game** or **Join Game**
- The host screen generates a **room code + QR code**; phones that scan it land
  directly in the room
- 2–4 players; the host can add **AI opponents** to fill seats

## How it plays

- 10×10 board. The outer ring is the **Word Runway**; the inner 6×6 squares
  carry printed letters covered by 36 black **house pyramids**; each of the four
  colors starts with 30 pyramids in six stacks of five.
- On your turn: tap the square where your word starts, choose Across/Down, and
  type a word (3+ letters). The engine automatically uses matching exposed
  letters in place and moves exposed player pyramids (yours *or* stolen from
  opponents) to complete the word.
- Every word must be in the dictionary and must use at least **one of your own
  pyramids** and **one black letter** (house pyramid or printed board letter),
  and must move at least one pyramid.
- All pyramids used in the word are captured and score their **tip values**
  (1–9). Printed letters score nothing and stay on the board.
- The game ends when any seated player's color is fully cleared from the board
  (or after two full rounds of passes). Remaining pyramids of your color on the
  board **count against you**. Highest score wins.

### Digital adaptations from the tabletop rules

- Word validity is checked automatically against a 359k-word English
  dictionary, so the challenge/forfeit flow isn't needed — illegal words are
  simply rejected with no penalty and the turn continues.
- Words are straight lines only (runway squares can be used, but the corner
  "bend" rule is not implemented).
- "Lowest exposed tips goes first" is applied; the tie-break recount uses seat
  order instead of removing a layer.

## Tech

- Node.js + Express + `ws` (no build step); vanilla JS frontend
- `qrcode` for join QR generation; rooms are in-memory with 4-letter codes
- Server-authoritative rules engine in `server/game.js` (pure, unit-tested)
- Built-in AI opponents (`findMove`) used both in-game and by the test harness

## Testing

```bash
npm test           # rules engine unit tests (node:test)
npm run e2e        # spawns the real server, verifies room codes + decodes the
                   # QR PNG, then AI players play 5 full games over WebSockets
node test/ui.js    # Playwright browser test: home page, host QR lobby, phone
                   # join, full televised bot game, mid-game phone rejoin
```

See `TEST_REPORT.md` for the latest results.
