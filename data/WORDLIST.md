# Word list provenance

`words.txt` is **generated** by `node tools/build-wordlist.js` from the files in
`data/wordlists/`. It holds 125,378 lowercase words of 3-10 letters, one per
line. Do not edit it by hand; edit a source file and rebuild.

| Source file | What it is | Licence |
|---|---|---|
| `wordlists/enable.txt` | The **ENABLE** word list (172,823 words), the only word source | Public domain, as documented by its maintainers and reproduced in Debian's `scowl` package copyright file (<https://sources.debian.org/src/scowl/7.1-1/Copyright/>). Credit: the ENABLE originators; Alan Beale and M. Cooper are named in that notice. |
| `wordlists/exclude.txt` | 69 slur and hateful-term forms removed | n/a (our editorial list) |

**No share-alike or attribution-licensed material is included.** An earlier
revision added a hand-picked supplement of modern words checked against
Wiktionary (CC BY-SA 4.0); it was removed on purpose so the word list carries no
licence conditions beyond crediting ENABLE. The trade-off is that the list has
no post-2000 slang (for example "rizz", "yeet", "selfie", "emoji").

## Adding words later
Only add words from a source whose licence you have read and that permits
bundling in a game. Put them in a new file under `data/wordlists/`, add that file
to `tools/build-wordlist.js`, record it in the table above, and rebuild.
Candidate sources and their terms were researched on 2026-10-13: the ESDB/SCOWL
list (MIT-like; abbreviations, brand names and slurs must be filtered out), Open
English WordNet (CC BY 4.0, base forms only), and the NASPA Word List (licensed
by NASPA; free developer tier under about US$1,000 annual revenue). None is in
use.

## Offensive words
ENABLE, like other Scrabble-style lists, contains slurs. They are removed by
`exclude.txt`. General profanity is left in. Words that are ordinary words but
sometimes used as slurs (for example "chink", "dyke", "queer") are also left in;
add them to `exclude.txt` and rebuild if you want them gone.
`test/wordlist.test.js` checks every excluded word is absent and that innocent
look-alikes (spicy, spices, beanery) were not removed by accident.

## Integrity
- **SHA-256 of words.txt (LF line endings):** `9fc0a9e45b23fece9b7a10fd39634f4345ffa993f781eb72f7f233f33cb50ba1`
- `test/wordlist.test.js` fails if the file drifts from a fresh build, if known
  junk or an excluded word appears, or if this note stops matching the file.
- This note is not legal advice.
