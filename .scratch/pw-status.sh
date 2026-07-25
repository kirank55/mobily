#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

echo "=== stuck playwright/chromium? ==="
pgrep -af 'playwright|chromium|chrome' | head -30 || true

echo "=== browsers installed? ==="
pnpm exec playwright install --dry-run 2>&1 | head -20 || true
ls ~/.cache/ms-playwright 2>/dev/null | head -10 || true

echo "=== TerminalView TERMINAL_SOURCE / helpers ==="
sed -n '24,50p' src/terminal/TerminalView.tsx
# does generated helpers include keepFocusedCursorVisible?
grep -c 'keepFocusedCursorVisible\|touchGesture\|presentSessionLayout' src/terminal/xtermAssets.generated.ts src/terminal/terminalDocument.js dev/term.html 2>/dev/null || true

echo "=== kill hung pw from this agent if any (careful) ==="
# Only kill the test we started if still hung with no output - find by terminalSnapshot
ps -p 14328 -o pid,cmd 2>/dev/null || true
# find child wsl playwright
pgrep -af 'playwright test tests/browser/terminalSnapshot' || true