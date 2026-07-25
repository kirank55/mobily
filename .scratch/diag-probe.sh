#!/usr/bin/env bash
set -u
cd /home/kiran/code-wsl/mobily

echo "======== BEFORE probe ========"
tmux capture-pane -t mobily-devtunnels-test -p -S -30 | tee .scratch/diag-capture-before-probe.txt | tail -20

echo "======== send Enter ========"
tmux send-keys -t mobily-devtunnels-test Enter
sleep 1
echo "======== AFTER Enter ========"
tmux capture-pane -t mobily-devtunnels-test -p -S -30 | tee .scratch/diag-capture-after-enter.txt | tail -25

echo "======== send echo probe ========"
tmux send-keys -t mobily-devtunnels-test 'echo probe-from-tmux' Enter
sleep 1
echo "======== AFTER probe ========"
tmux capture-pane -t mobily-devtunnels-test -p -S -40 | tee .scratch/diag-capture-after-probe.txt | tail -30

echo "======== compare usb-test panes (healthy?) ========"
tmux list-panes -t mobily-usb-test -F '#{session_name} #{pane_pid} #{pane_tty} #{pane_current_command} #{pane_title}'
tmux capture-pane -t mobily-usb-test -p -S -15 | tail -20

echo "======== any shell under station? ========"
pstree -ap 415689 2>/dev/null | head -40
# look for pts owned by node children
ls -l /proc/415689/fd 2>/dev/null | head -50
# PTY masters?
ls -l /proc/415689/fd 2>/dev/null | grep -E 'pts|pty|socket' | head -40

echo "======== .scratch logs ========"
ls -la .scratch/*.log 2>/dev/null || true
for f in .scratch/station-tunnel.log .scratch/diag*.txt; do
  [ -f "$f" ] || continue
  echo "--- $f errors ---"
  grep -Ein 'error|fail|PTY|closed|write|auth|frame' "$f" 2>/dev/null | tail -20 || true
done