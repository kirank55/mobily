// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/terminal/xtermAssets.generated.ts'],
  },
  {
    files: ['src/terminal/terminalDocument.js'],
    rules: {
      // This file emits a deliberately ES5-compatible script for Android WebView.
      'no-var': 'off',
      'import/first': 'off',
    },
  },
]);
