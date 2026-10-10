// Asset pipeline: grunt assets  (clean -> render -> sprites)
// Needs Blender. Set BLENDER=/path/to/blender if it is not at the default below.
// Built assets in public/assets are committed; the server never needs Blender or Grunt.
const blender = process.env.BLENDER || 'G:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const SHEETS = ['red', 'blue', 'green', 'yellow', 'house'];

// Percent-based sprite CSS so one atlas scales to any cell size.
function spriteCss(data) {
  const { width: W, height: H } = data.spritesheet;
  const colour = data.sprites[0].name.split('-')[0];
  const out = [`.spr-${colour}{background:url(/assets/pyr-${colour}.png) no-repeat;` +
    `background-size:${(W / data.sprites[0].width * 100).toFixed(3)}% ${(H / data.sprites[0].height * 100).toFixed(3)}%}`];
  for (const s of data.sprites) {
    const px = (s.x / (W - s.width) * 100).toFixed(3);
    const py = (s.y / (H - s.height) * 100).toFixed(3);
    out.push(`.pyr-${s.name}{background-position:${px}% ${py}%}`);
  }
  return out.join('\n') + '\n';
}

module.exports = function (grunt) {
  const sprite = {};
  for (const c of SHEETS) {
    sprite[c] = {
      src: [`build/pyramids/${c}-*.png`],
      dest: `public/assets/pyr-${c}.png`,
      destCss: `public/assets/pyr-${c}.css`,
      padding: 2,
      cssTemplate: spriteCss,
    };
  }

  grunt.initConfig({
    clean: { build: ['build/pyramids'], sprites: ['public/assets/pyr*.png', 'public/assets/pyr*.css'] },
    exec: {
      unit: 'node --test test/unit.test.js test/presentation.test.js test/security.test.js test/origin.test.js test/validate.test.js test/parity.test.js test/disconnect.test.js',
      network: 'node test/e2e.js 5',
      ui: 'node test/ui.js',
      visual3d: 'node test/visual-3d.js',
      pieces: 'node tools/export-piece-data.js',
      blender: `"${blender}" --background --python tools/render-pyramids.py`,
    },
    sprite,
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-exec');
  grunt.loadNpmTasks('grunt-spritesmith');

  grunt.registerTask('render', ['exec:pieces', 'exec:blender']);
  // Verification never regenerates or deletes the artwork.
  grunt.registerTask('verify', ['exec:unit', 'exec:network']);
  // Browser suites (need Playwright's Chromium): the DOM board with WebGL off, then the real 3D board.
  grunt.registerTask('verify-ui', ['exec:ui', 'exec:visual3d']);
  grunt.registerTask('assets-3d', 'Copy the pinned 3D runtime without rebuilding sprites', () => {
    for (const name of ['three.module.js', 'three.core.js']) {
      grunt.file.copy('node_modules/three/build/' + name, 'public/assets/three/' + name);
    }
    grunt.file.copy('node_modules/three/LICENSE', 'public/assets/three/LICENSE');
  });
  grunt.registerTask('sprites-css', () => {
    const css = SHEETS.map((c) => grunt.file.read(`public/assets/pyr-${c}.css`)).join('');
    SHEETS.forEach((c) => grunt.file.delete(`public/assets/pyr-${c}.css`));
    grunt.file.write('public/assets/pyr.css', css);
  });
  // Palette-quantise the atlases (8-bit PNG): ~4x smaller, visually the same at cell size.
  grunt.registerTask('shrink', function () {
    const done = this.async();
    const sharp = require('sharp');
    Promise.all(SHEETS.map(async (c) => {
      const f = `public/assets/pyr-${c}.png`;
      const buf = await sharp(f).png({ palette: true, quality: 85, effort: 10, compressionLevel: 9 }).toBuffer();
      require('fs').writeFileSync(f, buf);
    })).then(() => done(), (e) => done(grunt.util.error(e.message)));
  });
  grunt.registerTask('sprites', ['clean:sprites', ...SHEETS.map((c) => `sprite:${c}`), 'sprites-css', 'shrink']);
  grunt.registerTask('assets', ['clean:build', 'render', 'sprites']);
  grunt.registerTask('default', ['assets']);
};
