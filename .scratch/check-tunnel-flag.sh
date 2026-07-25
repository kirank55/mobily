#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:${HOME}/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
echo "=== CLI help (tunnel-related) ==="
pnpm --filter mobily exec node dist/index.js -h 2>&1 | head -80
echo "=== README tunnel mentions ==="
grep -n -i 'tunnel' README.md docs/tunnel-terminal-testing.md 2>/dev/null | head -40