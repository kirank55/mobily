export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000
LOG=/home/kiran/code-wsl/mobily/.scratch/pw-tty.txt
# allocate a pty via script(1)
script -q -e -c 'node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list --workers=1' "$LOG" &
PID=$!
for i in $(seq 1 90); do
  if ! kill -0 $PID 2>/dev/null; then
    wait $PID
    EC=$?
    echo "WRAPPER_EXIT=$EC" >> "$LOG"
    break
  fi
  sleep 1
done
if kill -0 $PID 2>/dev/null; then
  echo "HUNG" >> "$LOG"
  kill -9 $PID $(pgrep -P $PID) 2>/dev/null
  echo "WRAPPER_EXIT=124" >> "$LOG"
fi
# also extract PLAYWRIGHT-ish exit from log if present
tail -80 "$LOG"