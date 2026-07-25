#!/usr/bin/env bash
set -u
cd /home/kiran/code-wsl/mobily
mkdir -p .scratch

echo "======== 1) CAPTURE -200 ========"
tmux capture-pane -t mobily-devtunnels-test -p -S -200 | tee .scratch/diag-capture1.txt

echo "======== 2) PGREP ========"
pgrep -af 'dist/index.js|devtunnel|tmux' || true

echo "======== 3) LIST PANES ========"
tmux list-panes -a -F '#{session_name} #{pane_pid} #{pane_tty} #{pane_current_command}' || true

echo "======== 4) LIST SESSIONS ========"
tmux list-sessions || true

echo "======== 5) FOREST for devtunnels node ========"
for pid in $(pgrep -f 'dist/index.js --tunnel devtunnels' || true); do
  echo "--- pid $pid ---"
  ps --forest -g $(ps -o sid= -p $pid | tr -d ' ') -o pid,ppid,sid,tty,stat,cmd 2>/dev/null || ps -p $pid -o pid,ppid,tty,stat,cmd
  pstree -p $pid 2>/dev/null || true
done
# also pane pid
PANE_PID=$(tmux list-panes -t mobily-devtunnels-test -F '#{pane_pid}' 2>/dev/null | head -1)
echo "PANE_PID=$PANE_PID"
if [ -n "${PANE_PID:-}" ]; then
  echo "======== pstree pane ========"
  pstree -ap "$PANE_PID" 2>/dev/null || ps --forest -g $(ps -o sid= -p "$PANE_PID" | tr -d ' ') -o pid,ppid,tty,stat,wchan,cmd 2>/dev/null
  echo "======== /proc children ========"
  ls -l /proc/"$PANE_PID"/fd 2>/dev/null | head -40
  tr '\0' ' ' < /proc/"$PANE_PID"/cmdline; echo
  cat /proc/"$PANE_PID"/status 2>/dev/null | egrep '^(Name|State|PPid|Uid)' 
fi