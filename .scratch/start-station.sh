#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:/home/kiran/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
LOG=/home/kiran/code-wsl/mobily/.scratch/station-tunnel.log
PIDFILE=/home/kiran/code-wsl/mobily/.scratch/station-tunnel.pid
rm -f "$LOG" "$PIDFILE"
echo "=== starting station ==="
nohup pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --verbose >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "PID: $(cat "$PIDFILE")"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  bytes=$(wc -c <"$LOG" 2>/dev/null || echo 0)
  echo "--- after $((i*5))s (log bytes: $bytes) ---"
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "PROCESS EXITED early"
    break
  fi
done
echo "=== STATION LOG (full) ==="
cat "$LOG"
echo "=== PROCESS STATUS ==="
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "RUNNING pid=$(cat "$PIDFILE")"
  ps -p "$(cat "$PIDFILE")" -o pid,cmd || true
  pgrep -af "dist/index.js --tunnel" || true
else
  echo "NOT RUNNING"
  pgrep -af "dist/index.js --tunnel" || true
fi