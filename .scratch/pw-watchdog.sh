export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
rm -rf /tmp/playwright-transform-cache-1000
LOG=/home/kiran/code-wsl/mobily/.scratch/pw-final.txt
echo "START $(date -Is)" > "$LOG"
# start playwright in background
node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list --timeout=30000 >> "$LOG" 2>&1 &
PID=$!
echo "PID=$PID" >> "$LOG"
# wait up to 90s
for i in $(seq 1 90); do
  if ! kill -0 $PID 2>/dev/null; then
    wait $PID
    EC=$?
    echo "PLAYWRIGHT_EXIT=$EC" >> "$LOG"
    echo "END $(date -Is)" >> "$LOG"
    cat "$LOG"
    exit 0
  fi
  sleep 1
done
echo "KILLING hung playwright PID=$PID after 90s" >> "$LOG"
kill -9 $PID 2>/dev/null
echo "PLAYWRIGHT_EXIT=124" >> "$LOG"
echo "END $(date -Is)" >> "$LOG"
# dump any child state
ps -fp $PID 2>>"$LOG" || true
cat "$LOG"