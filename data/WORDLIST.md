# Word list provenance

`words.txt` is **generated** by `node tools/build-wordlist.js` from the files in
`data/wordlists/`. It holds 125,661 lowercase words of 3-10 letters, one per
line. Do not edit it by hand; edit a source file and rebuild.

| Source file | What it is | Licence |
|---|---|---|
| `wordlists/enable.txt` | The **ENABLE** word list (172,823 words), the base | Public domain, as documented by its maintainers and reproduced in Debian's `scowl` package copyright file (<https://sources.debian.org/src/scowl/7.1-1/Copyright/>). Credit: the ENABLE originators; Alan Beale and M. Cooper are named in that notice. |
| `wordlists/supplement.txt` | 214 modern words (e.g. rizz, yeet, doomscroll, selfie, emoji) chosen by hand and each confirmed to have an English entry on Wiktionary on 2026-10-13. Candidate words were drawn from the ESDB list below, dictionary new-word announcements, and Wiktionary. | The selection is offered under **CC BY-SA 4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>) with attribution to Wiktionary contributors (<https://en.wiktionary.org>). |
| `wordlists/exclude.txt` | Optional list of words to remove from either source (absent unless needed) | n/a |

**ESDB / SCOWL v2** (<https://github.com/en-wl/wordlist>, Kevin Atkinson, release
2026-02-25) was used as a source of candidate words. It is not copied in bulk
(it contains abbreviations, brand names and offensive words). Its licence
notice is kept in `licenses/ESDB-COPYRIGHT.txt` and credited on the Credits page.

## Why not a bulk import
Filtering the ESDB list to lowercase a-z still brought back abbreviations
(bldg, rcpt, adv), Roman numerals, brand names (google, hoover) and slurs. The
Wiktionary check only confirms a word *has an English entry* (it also accepts
abbreviations), so every supplement word was picked by hand first.

## Integrity
- **SHA-256 of words.txt (LF line endings):** `8cb13ad1654b5045d56a2fe855f2f485d2322dc566967e5c10da2b74651a0425`
- `test/wordlist.test.js` fails if the file drifts from a fresh build, if known
  junk appears, or if this note stops matching the file.
- This note is not legal advice. The share-alike effect of CC BY-SA on a word
  list is untested; the supplement is kept in its own file and credited so it
  can be handled separately if needed.
