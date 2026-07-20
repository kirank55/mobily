export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000

cat > tests/browser/_smoke.pw.mjs <<'EOF'
import { test, expect } from '@playwright/test';
test('smoke', async ({ page }) => {
  await page.setContent('<h1>hi</h1>');
  await expect(page.locator('h1')).toHaveText('hi');
});
EOF

LOG=/home/kiran/code-wsl/mobily/.scratch/pw-smoke2.txt
# unbuffered via stdbuf if available; also DEBUG
(command -v stdbuf >/dev/null && STD=stdbuf -oL -eL || STD=)
$STD env DEBUG=pw:test* node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/_smoke.pw.mjs --reporter=line --workers=1 > "$LOG" 2>&1 &
PID=$!
for i in $(seq 1 45); do
  if ! kill -0 $PID 2>/dev/null; then wait $PID; echo "SMOKE_EXIT=$?" >> "$LOG"; break; fi
  if [ $((i % 5)) -eq 0 ]; then echo "tick=$i bytes=$(wc -c < "$LOG")" >> "$LOG"; fi
  sleep 1
done
if kill -0 $PID 2>/dev/null; then echo SMOKE_HUNG >> "$LOG"; kill -9 $PID; echo SMOKE_EXIT=124 >> "$LOG"; fi
cat "$LOG"
rm -f tests/browser/_smoke.pw.mjs