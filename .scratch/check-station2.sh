#!/usr/bin/env bash
set -u
echo "=== any remaining station/node related ==="
pgrep -af 'dist/index.js' || echo none
echo "=== tmux sessions ==="
tmux ls 2>&1 || true
echo "=== log mtime / size ==="
stat /home/kiran/code-wsl/mobily/.scratch/station-tunnel.log
echo "=== log head (errors?) ==="
head -n 20 /home/kiran/code-wsl/mobily/.scratch/station-tunnel.log
echo "=== grep errors in log ==="
grep -Ein 'error|fail|fatal|EADDR|denied|login' /home/kiran/code-wsl/mobily/.scratch/station-tunnel.log || echo "no error keywords in log"