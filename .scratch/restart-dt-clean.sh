#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:${PATH}"
cd /home/kiran/code-wsl/mobily

echo "=== 1) kill broken sessions only ==="
tmux kill-session -t mobily-devtunnels-test 2>/dev/null || true
tmux kill-session -t mobily-dt-launcher 2>/dev/null || true
tmux kill-session -t mobily-dt-shell 2>/dev/null || true
echo "remaining sessions:"
tmux ls 2>&1 || true

echo "=== 2) CLI help tunnel lines ==="
pnpm --filter mobily exec node dist/index.js -h 2>&1 | grep -Ein 'tunnel|devtunnel' || true

echo "=== 3) start launcher with --tunnel devtunnels --session mobily-dt-shell ==="
tmux new-session -d -s mobily-dt-launcher
sleep 1
tmux send-keys -t mobily-dt-launcher "cd /home/kiran/code-wsl/mobily && export PATH=\"$HOME/bin:\\" && export NVM_DIR=\"$HOME/.nvm\" && . \"\\/nvm.sh\" && export PATH=\"$HOME/.local/share/pnpm:\C:\Users\kiran/bin:\\" && pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --verbose --session mobily-dt-shell" Enter

echo "=== 4) wait 50s ==="
sleep 50

echo "=== capture launcher ==="
tmux capture-pane -t mobily-dt-launcher -p -S -80

echo "=== list-sessions ==="
tmux list-sessions

echo "=== list-panes ==="
tmux list-panes -a -F '#{session_name} #{pane_current_command}'

echo "=== pgrep ==="
pgrep -af 'dist/index.js.*tunnel' || true

echo "=== shell session panes detail ==="
tmux list-panes -t mobily-dt-shell -F 'session=#{session_name} pid=#{pane_pid} tty=#{pane_tty} cmd=#{pane_current_command}' 2>&1 || echo 'mobily-dt-shell missing'