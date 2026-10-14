# Word list provenance

`words.txt` is **generated** by `node tools/build-wordlist.js` from the files in
`data/wordlists/`. It holds 125,795 lowercase words of 3-10 letters, one per
line. Do not edit it by hand; edit a source file and rebuild.

| Source file | What it is | Licence |
|---|---|---|
| `wordlists/enable.txt` | The **ENABLE** word list (172,823 words), the base | Public domain, as documented by its maintainers and reproduced in Debian's `scowl` package copyright file (<https://sources.debian.org/src/scowl/7.1-1/Copyright/>). Credit: the ENABLE originators; Alan Beale and M. Cooper are named in that notice. |
| `wordlists/house.txt` | 273 modern English words that ENABLE (compiled in the 1990s) predates, such as selfie, emoji, rizz, yeet, doomscroll. Written for this game from general knowledge; **no third-party word list was copied or used as a source.** | The project's own file. No outside licence applies. |
| `wordlists/neol2016.txt` | 144 words from Alan Beale's `neol2016` neologism list (12dicts 6.0.2, `Special/neol2016.txt`, <http://wordlist.aspell.net/12dicts/>), regular a-z words only, hand-reviewed: slurs, crude terms, loaded political labels and trademark-only names removed. | Public domain, released by its author, who asks for acknowledgment (given on the credits page). |
| `wordlists/exclude.txt` | 69 slur and hateful-term forms removed from every source | n/a (our editorial list) |

**No share-alike or attribution-licensed material is included.** An earlier
revision shipped a supplement checked against Wiktionary (CC BY-SA 4.0) and
credited it; that file was removed. The house list carries the same kind of words
(individual words are facts, not copyrightable), but is authored here and does
not depend on, copy, or credit any outside dataset. The words were spell-checked
against a public dictionary site once, as quality control only.

## Limits
- The house list is a **short** set of modern words, not a complete modern
  dictionary. The base is still a 1990s Scrabble-style list.
- General profanity remains playable. Slurs are removed (`exclude.txt`).
  Ordinary words that are sometimes used as slurs (for example "chink", "dyke",
  "queer") are left in; add them to `exclude.txt` and rebuild to remove them.
- A wider modern vocabulary would need a source whose licence has been read and
  permits bundling in a game. Candidates researched on 2026-10-13 and not in use:
  ESDB/SCOWL (MIT-like; abbreviations, brands and slurs must be filtered), Open
  English WordNet (CC BY 4.0, base forms only), and the NASPA Word List (licensed
  by NASPA). `neol2016` (2016) predates words like rizz and yeet; those are in the
  house list.
- This note is not legal advice.

## Integrity
- **SHA-256 of words.txt (LF line endings):** `d3b8855663b22884c24d9128222a07193be215bb77a02c21acbe7e1d205082c6`
- `test/wordlist.test.js` fails if the file drifts from a fresh build, if known
  junk or an excluded word appears, or if this note stops matching the file.
