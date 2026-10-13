# Word list provenance

`words.txt` is **generated** by `node tools/build-wordlist.js` from the files in
`data/wordlists/`. It holds 125,592 lowercase words of 3-10 letters, one per
line. Do not edit it by hand; edit a source file and rebuild.

| Source file | What it is | Licence |
|---|---|---|
| `wordlists/enable.txt` | The **ENABLE** word list (172,823 words), the base | Public domain, as documented by its maintainers and reproduced in Debian's `scowl` package copyright file (<https://sources.debian.org/src/scowl/7.1-1/Copyright/>). Credit: the ENABLE originators; Alan Beale and M. Cooper are named in that notice. |
| `wordlists/supplement.txt` | 214 modern words (e.g. rizz, yeet, doomscroll, selfie, emoji) chosen by hand; each was confirmed to have an English entry on Wiktionary on 2026-10-13. Candidates came from the ESDB list below, dictionary new-word announcements, and Wiktionary. | The selection is offered under **CC BY-SA 4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>) with attribution to Wiktionary contributors (<https://en.wiktionary.org>). |
| `wordlists/exclude.txt` | 69 slur and hateful-term forms removed from every source | n/a (our editorial list) |

**ESDB / SCOWL v2** (<https://github.com/en-wl/wordlist>, Kevin Atkinson, release
2026-02-25) was used as a source of candidate words. It is not copied in bulk
(it contains abbreviations, brand names and offensive words). Its licence
notice is kept in `licenses/ESDB-COPYRIGHT.txt` and credited on the Credits page.

## Why not a bulk import
Filtering the ESDB list to lowercase a-z still brought back abbreviations
(bldg, rcpt, adv), Roman numerals, brand names (google, hoover) and slurs. The
Wiktionary check only confirms a word *has an English entry* (it also accepts
abbreviations), so every supplement word was picked by hand first.

## Offensive words
ENABLE, like other Scrabble-style lists, contains slurs. They are removed by
`exclude.txt`. General profanity is left in. Words that are ordinary words but
sometimes used as slurs (for example "chink", "dyke", "queer") are also left in;
add them to `exclude.txt` and rebuild if you want them gone. `test/wordlist.test.js`
checks every excluded word is absent and that innocent look-alikes
(spicy, spices, beanery) were not removed by accident.

## The share-alike question
The supplement was assembled by hand; Wiktionary was queried only to confirm that
each word exists, and no Wiktionary entry text or data file is copied. Whether
such a bare list could ever count as a derivative under CC BY-SA is untested, so
the supplement is kept in its **own file**, licensed CC BY-SA 4.0 and credited. If
that file's terms were ever a concern, deleting `supplement.txt` and rebuilding
removes it completely; nothing else depends on it. For a commercial launch, have
counsel confirm. This note is not legal advice.

## Integrity
- **SHA-256 of words.txt (LF line endings):** `9747f98c115d0db72fcbed5dbfd6cb2dea6b2bd984dc1e0c0fbe8ab236ba99c8`
- `test/wordlist.test.js` fails if the file drifts from a fresh build, if known
  junk or an excluded word appears, or if this note stops matching the file.
