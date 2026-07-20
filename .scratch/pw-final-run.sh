export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000
rm -f tests/browser/_smoke.pw.mjs

echo "NODE=$(node -v)"
echo "START $(date -Is)"
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs
EC=$?
echo "PLAYWRIGHT_EXIT=$EC"
echo "END $(date -Is)"
exit $EC