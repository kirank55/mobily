export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1

echo "=== versions ==="
node -e 'const p=require("/home/kiran/code-wsl/mobily/node_modules/@playwright/test/package.json"); const c=require("/home/kiran/code-wsl/mobily/node_modules/playwright/package.json"); const pc=require("/home/kiran/code-wsl/mobily/node_modules/playwright-core/package.json"); console.log({test:p.version, playwright:c.version, core:pc.version});'

echo "=== chromium ==="
CHROME="$HOME/.cache/ms-playwright/chromium-1161/chrome-linux/chrome"
ls -la "$CHROME"
timeout 15 "$CHROME" --headless --disable-gpu --dump-dom about:blank 2>&1 | head -20
echo CHROME_EXIT=$?

echo "=== minimal test ==="
cat > /tmp/minimal.pw.mjs <<'EOF'
import { test, expect } from '@playwright/test';
test('smoke', async ({ page }) => {
  await page.setContent('<h1>hi</h1>');
  await expect(page.locator('h1')).toHaveText('hi');
});
EOF
rm -rf /tmp/playwright-transform-cache-1000
LOG=/home/kiran/code-wsl/mobily/.scratch/pw-minimal.txt
node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test /tmp/minimal.pw.mjs --config=playwright.config.ts --reporter=list > "$LOG" 2>&1 &
PID=$!
for i in $(seq 1 45); do
  if ! kill -0 $PID 2>/dev/null; then wait $PID; echo MINIMAL_EXIT=$? >> "$LOG"; break; fi
  sleep 1
done
if kill -0 $PID 2>/dev/null; then echo MINIMAL_HUNG >> "$LOG"; kill -9 $PID; fi
cat "$LOG"