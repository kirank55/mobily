#!/usr/bin/env bash
set -eu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
cd /home/kiran/code-wsl/mobily/android
export CI=1
PW=/home/kiran/code-wsl/mobily/node_modules/playwright/cli.js
OUT=/home/kiran/code-wsl/mobily/.scratch/pw-one.txt
echo starting > "$OUT"
echo running_list >> "$OUT"
timeout 45 node "$PW" test tests/browser/terminalSnapshot.pw.mjs --list >>"$OUT" 2>&1 || echo LIST_FAIL:$? >>"$OUT"
echo running_test >> "$OUT"
timeout 90 node "$PW" test tests/browser/terminalSnapshot.pw.mjs -g "blank space" --reporter=line >>"$OUT" 2>&1 || echo RUN_FAIL:$? >>"$OUT"
echo done >> "$OUT"
wc -l "$OUT"
cat "$OUT"