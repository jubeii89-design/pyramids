'use strict';
// Builds data/words.txt (the list the game validates against) from its sources:
//   data/wordlists/enable.txt   ENABLE, public domain (the base)
//   data/wordlists/house.txt    this project's own modern words (no outside licence)
//   data/wordlists/neol2016.txt reviewed words from Alan Beale's neol2016 (public domain)
//   data/wordlists/exclude.txt  words to remove (slurs and hateful terms)
// Only 3-10 letter lowercase a-z words are kept (the lengths the game accepts).
//   node tools/build-wordlist.js          write data/words.txt
//   node tools/build-wordlist.js --check  exit 1 if data/words.txt is out of date
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => {
  const file = path.join(root, 'data', 'wordlists', name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#'));
};

function build() {
  const exclude = new Set(read('exclude.txt'));
  const all = new Set([...read('enable.txt'), ...read('house.txt'), ...read('neol2016.txt')]);
  const words = [...all].filter((w) => /^[a-z]{3,10}$/.test(w) && !exclude.has(w)).sort();
  return { text: words.join('\n') + '\n', count: words.length };
}

module.exports = { build };

if (require.main === module) {
  const { text, count } = build();
  const target = path.join(root, 'data', 'words.txt');
  if (process.argv.includes('--check')) {
    const current = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) { console.error('data/words.txt is out of date: run node tools/build-wordlist.js'); process.exit(1); }
    console.log(`data/words.txt is up to date (${count} words)`);
  } else {
    fs.writeFileSync(target, text);
    console.log(`wrote data/words.txt: ${count} words`);
  }
}
