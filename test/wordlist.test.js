'use strict';
// The dictionary is a product decision: keep it clean and keep its provenance.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = path.join(__dirname, '..', 'data', 'words.txt');
const raw = fs.readFileSync(file, 'utf8');
const words = raw.split(/\r?\n/).filter(Boolean);
const set = new Set(words);

test('word list is plain lowercase a-z, one word per line, no duplicates', () => {
  assert.ok(words.length > 150000 && words.length < 200000, `unexpected size ${words.length}`);
  assert.ok(words.every((w) => /^[a-z]+$/.test(w)), 'only a-z');
  assert.strictEqual(set.size, words.length, 'no duplicates');
});

test('known junk from the previous list stays out', () => {
  for (const junk of ['rcpt', 'adv', 'isawa', 'fixe', 'apppetible', 'asssembler', 'blottto', 'bldg', 'bdrm', 'manjak', 'gozell', 'neebor']) {
    assert.ok(!set.has(junk), `"${junk}" must not be accepted`);
  }
});

test('ordinary words and the playable lengths are present', () => {
  for (const ok of ['cat', 'quiz', 'pyramid', 'zebra', 'letter', 'aah', 'vizsla', 'haloed', 'wined']) {
    assert.ok(set.has(ok), `"${ok}" should be accepted`);
  }
  const playable = words.filter((w) => w.length >= 3 && w.length <= 10);
  assert.ok(playable.length > 100000);
  assert.ok(words.filter((w) => w.length === 3).length > 800, 'enough three-letter words to play with');
});

test('the vowel-less entries are a short, known set (real words like "brr", "nth", "psst")', () => {
  const noVowel = words.filter((w) => !/[aeiouy]/.test(w));
  assert.ok(noVowel.length < 30, `unexpected number of vowel-less words: ${noVowel.length}`);
});

test('provenance note matches the file it describes', () => {
  const note = fs.readFileSync(path.join(__dirname, '..', 'data', 'WORDLIST.md'), 'utf8');
  const sha = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
  assert.ok(note.includes(sha), 'WORDLIST.md must record the current SHA-256; update it when words.txt changes');
  assert.ok(note.includes(words.length.toLocaleString('en-US')), 'WORDLIST.md must record the current word count');
});
