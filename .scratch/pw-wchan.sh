export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
export COLUMNS=120 LINES=40 TERM=xterm-256color
cd /home/kiran/code-wsl/mobily/android
pkill -9 -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
rm -rf /tmp/playwright-transform-cache-1000

node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list --workers=1 >/home/kiran/code-wsl/mobily/.scratch/pw-hang2.txt 2>&1 &
PID=$!
sleep 8
echo "=== pstree ==="
pstree -ap $PID 2>/dev/null || ps --forest -g $(ps -o sid= -p $PID) 2>/dev/null
echo "=== wchan/state ==="
for p in $(pgrep -P $PID; echo $PID; pgrep -f terminalSnapshot); do
  echo "PID $p state=$(cut -d' ' -f3 /proc/$p/stat 2>/dev/null) wchan=$(cat /proc/$p/wchan 2>/dev/null) cmd=$(tr '\0' ' ' </proc/$p/cmdline 2>/dev/null)"
done
echo "=== cache ==="
find /tmp/playwright-transform-cache-1000 -type f -exec ls -la {} \; 2>/dev/null
echo "=== lsof pipes/locks ==="
ls -la /proc/$PID/fd 2>/dev/null | head -40
# check children fds
for c in $(pgrep -P $PID); do echo "-- child $c"; ls /proc/$c/fd 2>/dev/null | wc -l; tr '\0' ' ' </proc/$c/cmdline; echo; cat /proc/$c/wchan; echo; done
sleep 5
# kill
kill -9 $PID $(pgrep -P $PID) 2>/dev/null