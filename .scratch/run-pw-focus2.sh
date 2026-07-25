#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

echo "=== kill broken playwright invocations ==="
pkill -f 'playwright test tests/browser/terminalSnapshot.pw.mjs' 2>/dev/null || true
sleep 2
pgrep -af 'playwright test tests/browser' || echo 'no pw test left'

echo "=== how pw loads HTML ==="
head -40 tests/browser/terminalSnapshot.pw.mjs

echo "=== generated helpers stale? ==="
grep -c 'keepFocusedCursorVisible' src/terminal/xtermAssets.generated.ts || echo 'generated:0'
grep -c 'keepFocusedCursorVisible' src/terminal/terminalDocument.js || true
# show what changed in generated
git -C /home/kiran/code-wsl/mobily diff --stat -- android/src/terminal/xtermAssets.generated.ts
git -C /home/kiran/code-wsl/mobily diff -- android/src/terminal/xtermAssets.generated.ts | head -40

echo "=== RUN pw with file-based grep (no shell pipe) ==="
# Use a simple substring that matches focus tests without |
set +e
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs --grep "keyboard|focused cursor|initial grid|horizontally with one finger|vertical swipe" 2>&1 | tee /home/kiran/code-wsl/mobily/.scratch/pw-focus-results.txt
echo "PLAYWRIGHT_EXIT:${PIPESTATUS[0]}"