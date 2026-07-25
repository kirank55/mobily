#!/usr/bin/env bash
set -u
echo "=== capture-pane -40 ==="
tmux capture-pane -t mobily-devtunnels-test -p -S -40
echo "=== pgrep devtunnels station ==="
pgrep -af 'dist/index.js --tunnel devtunnels' || pgrep -af 'dist/index.js.*devtunnels' || echo "NO MATCH"
echo "=== has-session ==="
tmux has-session -t mobily-devtunnels-test && echo YES || echo NO