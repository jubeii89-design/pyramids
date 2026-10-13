# Word list provenance

`words.txt` is the **ENABLE** word list ("Enhanced North American Benchmark
Lexicon"), 172,823 lowercase words, one per line.

- **Source:** the `enable1.txt` file from <https://github.com/dolph/dictionary>
  (a mirror of the ENABLE master list), downloaded 2026-10-13.
- **Licence:** documented as public domain by the list's maintainers; see the
  ENABLE notice reproduced in Debian's `scowl` package copyright file
  (<https://sources.debian.org/src/scowl/7.1-1/Copyright/>). This note is not
  legal advice; check the original distribution if you need a formal position.
- **SHA-256 of words.txt (LF line endings):** `3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89`
- **Replaced:** an earlier 359,039-entry list that contained typos
  (e.g. "apppetible"), abbreviations ("bldg", "rcpt") and non-words.

Game rules only use entries of 3-10 letters. To change the list, replace
`words.txt`, update this file, and run `npm test` (`test/wordlist.test.js`
checks its format and that known junk stays out).
