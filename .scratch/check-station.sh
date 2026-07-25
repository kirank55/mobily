#!/usr/bin/env bash
set -u
PIDFILE=/home/kiran/code-wsl/mobily/.scratch/station-tunnel.pid
LOG=/home/kiran/code-wsl/mobily/.scratch/station-tunnel.log
echo "=== PIDFILE ==="
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  echo "recorded_pid=$PID"
  if kill -0 "$PID" 2>/dev/null; then
    echo "pidfile_process: ALIVE"
    ps -p "$PID" -o pid,etime,cmd 2>/dev/null || true
  else
    echo "pidfile_process: DEAD"
  fi
else
  echo "pidfile: missing"
fi
echo "=== pgrep devtunnels station ==="
pgrep -af "dist/index.js --tunnel devtunnels" || echo "no devtunnels match"
pgrep -af "dist/index.js --tunnel devtunnels" || true
# correct spelling
pgrep -af "dist/index.js --tunnel devtunnels" 2>/dev/null || true
pgrep -af 'dist/index.js --tunnel devtunnels' || pgrep -af 'dist/index.js --tunnel' || true
echo "=== LOG EXISTS ==="
ls -la "$LOG" 2>&1
echo "=== TAIL 40 ==="
if [ -f "$LOG" ]; then
  tail -n 40 "$LOG"
else
  echo "log missing"
fi
echo "=== EXTRACT pairing/url ==="
if [ -f "$LOG" ]; then
  grep -E 'Pairing code:|Tunnel:|wss://|Connect via browser:|Ready to accept|error|Error|ERROR|failed|Failed' "$LOG" | tail -n 30
fi