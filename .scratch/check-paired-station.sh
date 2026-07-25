#!/usr/bin/env bash
set -u
export PATH="${HOME}/bin:${PATH}"
cd /home/kiran/code-wsl/mobily

echo "=== pgrep station ==="
pgrep -af 'dist/index.js.*tunnel' || echo "NO MATCH"

echo "=== tmux has-session mobily-devtunnels-test ==="
if tmux has-session -t mobily-devtunnels-test 2>/dev/null; then
  echo "has-session: YES"
else
  echo "has-session: NO"
fi

echo "=== tmux ls ==="
tmux ls 2>&1 || true

echo "=== capture-pane mobily-devtunnels-test (-120) ==="
tmux capture-pane -t mobily-devtunnels-test -p -S -120 2>&1

echo "=== pane/window info ==="
tmux list-panes -t mobily-devtunnels-test -F 'session=#{session_name} window=#{window_index} pane=#{pane_index} pid=#{pane_pid} cmd=#{pane_current_command} title=#{pane_title}' 2>&1 || true
tmux list-windows -t mobily-devtunnels-test -F 'window=#{window_index} name=#{window_name} layout=#{window_layout}' 2>&1 || true