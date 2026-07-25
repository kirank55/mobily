#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
pnpm generate:terminal-assets
pnpm exec vitest run tests/terminalDocument.test.ts
# Avoid bare | in --grep (pnpm/shell can treat it as a pipe).
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs \
  --grep 'focuses the keyboard' \
  --reporter=line
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs \
  --grep 'returns taps to keyboard' \
  --reporter=line
