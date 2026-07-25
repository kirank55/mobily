#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:${HOME}/bin:${PATH}"
cd /home/kiran/code-wsl/mobily

echo "=== digtunnel on PATH ==="
command -v devtunnel
devtunnel --version 2>&1 | head -5

test -f cli/dist/index.js || pnpm --filter mobily build

echo "=== existing tmux (before) ==="
tmux ls 2>&1 || true

echo "=== create durable session ==="
tmux kill-session -t mobily-devtunnels-test 2>/dev/null || true
tmux new-session -d -s mobily-devtunnels-test
sleep 1
tmux send-keys -t mobily-devtunnels-test "cd /home/kiran/code-wsl/mobily && export PATH=\"\$HOME/bin:\$PATH\" && export NVM_DIR=\"\$HOME/.nvm\" && . \"\$NVM_DIR/nvm.sh\" && export PNPM_HOME=\"\$HOME/.local/share/pnpm\" && export PATH=\"\$PNPM_HOME:\$HOME/bin:\$PATH\" && pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --verbose --session mobily-devtunnels-test" Enter

echo "=== waiting 55s ==="
sleep 55

echo "=== tmux capture-pane ==="
tmux capture-pane -t mobily-devtunnels-test -p -S -80

echo "=== pgrep ==="
pgrep -af 'dist/index.js.*tunnel' || echo "NO MATCH"

echo "=== tmux ls (after) ==="
tmux ls 2>&1 || true