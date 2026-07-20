pkill -f 'playwright test tests/browser/terminalSnapshot' 2>/dev/null || true
pkill -f 'run-playwright.sh' 2>/dev/null || true
sleep 1
pgrep -af playwright || echo 'no playwright'