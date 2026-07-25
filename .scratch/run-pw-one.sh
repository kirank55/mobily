#!/usr/bin/env bash
set -eu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
cd /home/kiran/code-wsl/mobily/android
export CI=1
OUT=/home/kiran/code-wsl/mobily/.scratch/pw-one.txt
: > "$OUT"
{
  echo "=== list ==="
  pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs --list
  echo "=== run ==="
  pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs -g 'blank space' --reporter=line
  echo RUN_EXIT:$?
} >"$OUT" 2>&1
wc -l "$OUT"
tail -n 80 "$OUT"
