#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

pkill -9 -f 'playwright test' 2>/dev/null || true
sleep 2

echo "=== chromium launch smoke ==="
timeout 45 node -e '
const { chromium } = require("playwright");
(async () => {
  console.log("launching...");
  const b = await chromium.launch({ headless: true });
  console.log("launched");
  const p = await b.newPage();
  await p.setContent("<h1>ok</h1>");
  console.log("content", await p.title());
  await b.close();
  console.log("closed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
' 2>&1
echo SMOKE_EXIT:$?

echo "=== playwright list (60s) ==="
timeout 60 pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs --list 2>&1 | head -50
echo LIST_EXIT:$?

echo "=== single test by line/name substring keyboard only ==="
timeout 120 pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs --grep "focuses the keyboard while" --reporter=line 2>&1 | tee /home/kiran/code-wsl/mobily/.scratch/pw-one.txt | tail -40
echo ONE_EXIT:$?