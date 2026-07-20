export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000

# sizes of embedded deps
wc -c node_modules/@xterm/xterm/css/xterm.css node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/addon-fit/lib/addon-fit.js 2>/dev/null
# workspace root resolution from test uses ../../.. from tests/browser = android/../ = mobily root? 
# file is android/tests/browser -> ../../.. = mobily root. But we cd android. node_modules may be hoisted to mobily/
ls -la ../node_modules/@xterm/xterm/lib/xterm.js | awk '{print $5,$9}'

LOG=/home/kiran/code-wsl/mobily/.scratch/pw-real.txt
echo "START $(date -Is)" > "$LOG"
DEBUG=pw:test*,pw:transform* node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list --workers=1 >> "$LOG" 2>&1 &
PID=$!
echo "PID=$PID" >> "$LOG"
for i in $(seq 1 60); do
  if ! kill -0 $PID 2>/dev/null; then
    wait $PID
    echo "PLAYWRIGHT_EXIT=$?" >> "$LOG"
    echo "END $(date -Is)" >> "$LOG"
    cat "$LOG"
    exit 0
  fi
  # every 10s dump a progress marker and whether transform cache grew
  if [ $((i % 10)) -eq 0 ]; then
    echo "tick=$i cache=$(du -sh /tmp/playwright-transform-cache-1000 2>/dev/null || echo none)" >> "$LOG"
  fi
  sleep 1
done
echo "HUNG after 60s" >> "$LOG"
# sample stack via /proc if possible
ls /proc/$PID/task 2>>"$LOG"
kill -9 $PID 2>/dev/null
echo "PLAYWRIGHT_EXIT=124" >> "$LOG"
echo "END $(date -Is)" >> "$LOG"
wc -l "$LOG"
tail -100 "$LOG"