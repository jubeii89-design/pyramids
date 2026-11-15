# Sound provenance

Every sound in the game is synthesized the moment it plays, in the player's
own browser, by `public/sounds.js` — plain Web Audio API oscillators (sine,
triangle, sawtooth) through gain envelopes. **There are no audio files in
this repository and no third-party recordings, samples, or sound libraries.**
Nothing here needs a licence beyond the project's own: the synthesis code is
original to this project.

The full cue set (each is a handful of notes; see the `CUES` table in
`public/sounds.js` for the exact frequencies):

| Cue        | When it plays                                              | Shape |
|------------|------------------------------------------------------------|-------|
| `join`     | a player joins the lobby (TV); you join (phone); unmuting  | two-note rising blip, C5→G5 |
| `yourturn` | it becomes your turn (phone, with the vibration)           | soft rising arpeggio D5–G5–B5 |
| `played`   | a word lands (TV for every word; phone for your own)       | two-note pluck G4→C5 |
| `steal`    | a word captured another colour's pyramids (TV); yours (phone) | descending sting A4–E4–B3 |
| `over`     | the game ends (TV, with the finals reveal)                 | small fanfare C5–E5–G5–C6 |

Mute: any `[data-sound-toggle]` button toggles all cues off; the choice is
stored on the device (`localStorage`, key `cp_muted`) and survives reloads
and new games. Browsers keep audio locked until the page is first touched,
so an untouched TV screen stays silent rather than erroring.

This document is the audio counterpart of `data/WORDLIST.md` and
`ASSETS.md` (same bar: nothing ships without documented provenance).
