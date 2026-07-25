#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

echo "======== playwright config ========"
ls playwright.config.* 2>/dev/null || true
head -40 playwright.config.* 2>/dev/null || true

echo "======== RUN focus-related playwright tests ========"
# Prefer grep filter for focus/keyboard/touch/cursor/viewport pan tests
set +e
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs \
  -g 'focuses the keyboard|returns taps to keyboard|keeps the focused cursor|fits the initial grid|pans the terminal horizontally|scrolls terminal history' \
  2>&1
echo "PLAYWRIGHT_EXIT:$?"