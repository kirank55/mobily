export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000

for ver in v22.22.2 v20.20.0 v24.14.1; do
  export PATH="$HOME/.nvm/versions/node/$ver/bin:$PATH"
  echo "===== NODE $ver $(node -v) ====="
  cat > tests/browser/_smoke.pw.mjs <<'EOF'
import { test, expect } from '@playwright/test';
test('smoke', async ({ page }) => {
  await page.setContent('<h1>hi</h1>');
  await expect(page.locator('h1')).toHaveText('hi');
});
EOF
  LOG=/home/kiran/code-wsl/mobily/.scratch/pw-node-$ver.txt
  env DEBUG=pw:test* node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/_smoke.pw.mjs --reporter=line --workers=1 > "$LOG" 2>&1 &
  PID=$!
  for i in $(seq 1 30); do
    if ! kill -0 $PID 2>/dev/null; then wait $PID; echo "EXIT=$?" >> "$LOG"; break; fi
    sleep 1
  done
  if kill -0 $PID 2>/dev/null; then echo HUNG >> "$LOG"; kill -9 $PID; echo EXIT=124 >> "$LOG"; fi
  tail -20 "$LOG"
  echo
done
rm -f tests/browser/_smoke.pw.mjs