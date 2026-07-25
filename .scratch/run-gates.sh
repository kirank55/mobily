#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:${PATH}"
cd /home/kiran/code-wsl/mobily
echo "=== ENV ==="
pwd
node -v
pnpm -v
if command -v devtunnel >/dev/null 2>&1; then
  echo "devtunnel : $(command -v devtunnel)"
  devtunnel --version
else
  echo "devtunnel : not found"
fi
echo "node_modules: $(test -d node_modules && echo present || echo missing)"
echo "=== GATE: typecheck ==="
set +e
pnpm typecheck
echo "typecheck EXIT:$?"