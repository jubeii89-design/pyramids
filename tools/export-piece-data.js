// Writes tools/pieces.json from the rules engine so the Blender models can
// never drift from the game's letters, values and palette.
const fs = require('fs');
const path = require('path');
const { COLORS, VALUES, PLAYER_LETTERS, HOUSE_LETTERS } = require('../server/game');

const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const hex = (name) => {
  const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  if (!m) throw new Error('missing CSS var --' + name);
  return m[1];
};

const palette = { house: hex('house') };
for (const c of COLORS) palette[c] = hex(c);
const body = {};
for (const k of ['lite', 'mid', 'dark', 'shadow']) body[k] = hex('pyr-' + k);

const houseLetters = [...new Set(HOUSE_LETTERS)].sort();
const pieces = [];
for (const color of COLORS)
  for (const letter of [...new Set(PLAYER_LETTERS)].sort())
    pieces.push({ id: `${color}-${letter}`, color, letter, value: VALUES[letter] });
for (const letter of houseLetters)
  pieces.push({ id: `house-${letter}`, color: 'house', letter, value: VALUES[letter] });

fs.writeFileSync(path.join(__dirname, 'pieces.json'),
  JSON.stringify({ palette, body, pieces }, null, 2) + '\n');
console.log(`wrote ${pieces.length} pieces`);
