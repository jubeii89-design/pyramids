// Verification tasks:  npx grunt verify      rules + network tests
//                      npx grunt verify-ui   real-browser suites (need Playwright's Chromium)
module.exports = function (grunt) {
  grunt.initConfig({
    exec: {
      unit: 'npm test', // one list of test files, in package.json
      network: 'node test/e2e.js 5',
      ui: 'node test/ui.js',
      tap: 'node test/tap-build.js',
    },
  });
  grunt.loadNpmTasks('grunt-exec');
  grunt.registerTask('verify', ['exec:unit', 'exec:network']);
  grunt.registerTask('verify-ui', ['exec:ui', 'exec:tap']);
  grunt.registerTask('default', ['verify']);
};
