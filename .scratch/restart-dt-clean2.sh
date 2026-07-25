#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily
chmod +x .scratch/start-dt-station.sh

echo "=== kill broken / failed launcher ==="
tmux kill-session -t mobily-devtunnels-test 2>/dev/null || true
tmux kill-session -t mobily-dt-launcher 2>/dev/null || true
tmux kill-session -t mobily-dt-shell 2>/dev/null || true
# confirm usb intact
tmux ls 2>&1 || true

echo "=== start clean launcher ==="
tmux new-session -d -s mobily-dt-launcher
sleep 1
tmux send-keys -t mobily-dt-launcher 'bash /home/kiran/code-wsl/mobily/.scratch/start-dt-station.sh' Enter

echo "=== wait 50s ==="
sleep 50

echo "=== capture launcher ==="
tmux capture-pane -t mobily-dt-launcher -p -S -80

echo "=== list-sessions ==="
tmux list-sessions

echo "=== list-panes ==="
tmux list-panes -a -F '#{session_name} #{pane_current_command}'

echo "=== pgrep ==="
pgrep -af 'dist/index.js.*tunnel' || true

echo "=== shell panes ==="
tmux list-panes -t mobily-dt-shell -F 'session=#{session_name} pid=#{pane_pid} tty=#{pane_tty} cmd=#{pane_current_command}' 2>&1 || echo 'mobily-dt-shell MISSING'