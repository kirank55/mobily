#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

echo "=== kill ALL playwright test/list for this repo ==="
pkill -f '/home/kiran/code-wsl/mobily/.*playwright' 2>/dev/null || true
pkill -f 'playwright test' 2>/dev/null || true
sleep 2
pgrep -af playwright | head -20 || echo 'clear'

# Ensure browsers present
if [ ! -d "$HOME/.cache/ms-playwright/chromium-1161" ] && [ ! -d "$HOME/.cache/ms-playwright/chromium_headless_shell-1161" ]; then
  echo "installing chromium..."
  pnpm exec playwright install chromium 2>&1 | tail -20
fi

echo "=== run with explicit args array (no pipe) ==="
set +e
# Use node to invoke so grep pattern is not shell-split
node ./node_modules/@playwright/test/cli.js test \
  tests/browser/terminalSnapshot.pw.mjs \
  --grep "keyboard|focused cursor|initial grid|one finger|vertical swipe" \
  --reporter=line \
  --timeout=60000 \
  > /home/kiran/code-wsl/mobily/.scratch/pw-focus-results.txt 2>&1
EC=$?
echo "PLAYWRIGHT_EXIT:$EC"
tail -n 80 /home/kiran/code-wsl/mobily/.scratch/pw-focus-results.txt