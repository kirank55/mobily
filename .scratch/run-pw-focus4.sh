#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily
pkill -f 'playwright test' 2>/dev/null || true
sleep 1
node .scratch/run-pw-focus.mjs | tee .scratch/pw-focus-results.txt
echo EXIT:${PIPESTATUS[0]}