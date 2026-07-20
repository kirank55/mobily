#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android || exit 99
export CI=1
LOG=/home/kiran/code-wsl/mobily/.scratch/pw-result.txt
echo "START $(date -Is)" > "$LOG"
echo "node=$(command -v node) $(node -v)" >> "$LOG"
echo "cli=$(ls /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js)" >> "$LOG"
# list tests first
node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --list >> "$LOG" 2>&1
echo "LIST_EXIT=$?" >> "$LOG"
timeout 120 node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list >> "$LOG" 2>&1
echo "PLAYWRIGHT_EXIT=$?" >> "$LOG"
echo "END $(date -Is)" >> "$LOG"