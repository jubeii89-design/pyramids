'use strict';
// The dictionary is a product decision: keep it clean, reproducible and credited.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { build } = require('../tools/build-wordlist');

const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'data', 'words.txt'), 'utf8');
const words = raw.split(/\r?\n/).filter(Boolean);
const set = new Set(words);
const lines = (f) => fs.readFileSync(path.join(root, 'data', 'wordlists', f), 'utf8').split(/\r?\n/).filter(Boolean);

test('word list is plain lowercase a-z, 3-10 letters, sorted, no duplicates', () => {
  assert.ok(words.length > 120000 && words.length < 135000, `unexpected size ${words.length}`);
  assert.ok(words.every((w) => /^[a-z]{3,10}$/.test(w)), '3-10 letters, a-z only');
  assert.strictEqual(set.size, words.length, 'no duplicates');
  assert.deepStrictEqual(words, [...words].sort(), 'sorted');
});

test('data/words.txt is exactly what the build script produces from the source files', () => {
  const { text } = build();
  assert.strictEqual(raw.replace(/\r\n/g, '\n'), text, 'run: node tools/build-wordlist.js');
});

test('known junk from the previous lists stays out', () => {
  for (const junk of ['rcpt', 'adv', 'isawa', 'fixe', 'apppetible', 'asssembler', 'blottto', 'bldg', 'bdrm', 'manjak', 'gozell', 'neebor', 'xxviii', 'contd', 'approx']) {
    assert.ok(!set.has(junk), `"${junk}" must not be accepted`);
  }
});

test('ordinary words and the playable lengths are present', () => {
  for (const ok of ['cat', 'quiz', 'pyramid', 'zebra', 'letter', 'aah', 'vizsla', 'haloed', 'wined']) assert.ok(set.has(ok), `"${ok}" should be accepted`);
  assert.ok(words.filter((w) => w.length === 3).length > 800, 'enough three-letter words to play with');
});

test('only public-domain and our own sources are used: no share-alike or attribution-licensed material', () => {
  const files = fs.readdirSync(path.join(root, 'data', 'wordlists')).sort();
  assert.deepStrictEqual(files, ['enable.txt', 'exclude.txt', 'house.txt'], 'no other word source files');
  assert.ok(!fs.existsSync(path.join(root, 'data', 'licenses')) || fs.readdirSync(path.join(root, 'data', 'licenses')).length === 0, 'no third-party licence notices needed');
  const credits = fs.readFileSync(path.join(root, 'public', 'credits.html'), 'utf8');
  assert.ok(!/CC BY-SA|Wiktionary|ESDB/i.test(credits), 'credits do not claim sources that are not used');
});

test('the house list is clean and holds modern words ENABLE lacks', () => {
  const house = lines('house.txt').filter((l) => !l.startsWith('#'));
  const enable = new Set(lines('enable.txt'));
  assert.ok(house.length > 150, 'house list is populated');
  assert.ok(house.every((w) => /^[a-z]{3,10}$/.test(w)), 'house list is clean a-z');
  assert.ok(house.every((w) => !enable.has(w)), 'house list only holds words ENABLE lacks');
  assert.ok(house.every((w) => set.has(w)), 'every house word is playable');
  for (const modern of ['rizz', 'yeet', 'doomscroll', 'selfie', 'emoji', 'hashtag', 'deepfake', 'podcast', 'webcam']) {
    assert.ok(set.has(modern), `"${modern}" should be accepted`);
  }
});

test('excluded slurs are absent and innocent look-alikes are not caught by accident', () => {
  const excluded = fs.readFileSync(path.join(root, 'data', 'wordlists', 'exclude.txt'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  assert.ok(excluded.length > 40, 'exclusion list is populated');
  for (const w of excluded) assert.ok(!set.has(w), `excluded word "${w}" must not be playable`);
  for (const ok of ['spicy', 'spices', 'spiced', 'beanery', 'poofy', 'classic', 'assassin', 'cocktail']) {
    assert.ok(set.has(ok), `"${ok}" is an ordinary word and must stay`);
  }
});

test('the vowel-less entries are a short, known set', () => {
  const noVowel = words.filter((w) => !/[aeiouy]/.test(w));
  assert.ok(noVowel.length < 30, `unexpected number of vowel-less words: ${noVowel.length}`);
});

test('provenance note and credits match the file they describe', () => {
  const note = fs.readFileSync(path.join(root, 'data', 'WORDLIST.md'), 'utf8');
  const sha = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
  assert.ok(note.includes(sha), 'WORDLIST.md must record the current SHA-256; update it when words.txt changes');
  assert.ok(note.includes(words.length.toLocaleString('en-US')), 'WORDLIST.md must record the current word count');
  const credits = fs.readFileSync(path.join(root, 'public', 'credits.html'), 'utf8');
  for (const needle of ['ENABLE', 'public domain', 'modern words', 'three.js']) assert.ok(credits.includes(needle), `credits page must mention ${needle}`);
});
