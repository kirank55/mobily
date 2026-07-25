#!/usr/bin/env bash
set -eu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
cd /home/kiran/code-wsl/mobily/android
echo "node=$(node -v)"
echo "playwright bin:"
ls -la ../node_modules/.bin/playwright
echo "trying --version"
timeout 20 pnpm exec playwright --version
echo "trying browser check"
timeout 30 ../node_modules/.bin/playwright install --dry-run 2>&1 | head -40 || true
echo "launch chromium headless shell"
CHROME=$(ls -d "$HOME/.cache/ms-playwright"/chromium_headless_shell-*/chrome-linux*/headless_shell 2>/dev/null | head -1)
echo "CHROME=$CHROME"
if [ -n "$CHROME" ]; then
  timeout 15 "$CHROME" --headless --disable-gpu --dump-dom about:blank 2>&1 | head -20 || echo chrome_exit:$?
fi
