#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:${HOME}/bin:${PATH}"
cd /home/kiran/code-wsl/mobily

echo "=== list-bindings (via CLI) ==="
pnpm --filter mobily exec node dist/index.js --list-bindings 2>&1 | head -60

echo "=== capture bottom again (prompt?) ==="
tmux capture-pane -t mobily-devtunnels-test -p -S -40

echo "=== grep connection keywords from full history buffer if any ==="
# history-limit dump
tmux capture-pane -t mobily-devtunnels-test -p -S -300 2>&1 | grep -Ein 'phone|connect|pair|auth|bound|binding|challenge|error|fail|latency|rtt|ms|snapshot|device' || true

echo "=== still alive ==="
pgrep -af 'dist/index.js --tunnel devtunnels' || pgrep -af '415689|devtunnels' || true
pgrep -af 'dist/index.js --tunnel devtunnels' 2>/dev/null || true
ps -p 415689 -o pid,etime,cmd 2>&1 || echo "node pid 415689 gone"