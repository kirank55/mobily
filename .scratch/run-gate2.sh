#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
# Include common install locations and login-shell PATH bits for devtunnel
export PATH="${PNPM_HOME}:${PATH}:/home/kiran/bin:${HOME}/.local/bin"
cd /home/kiran/code-wsl/mobily
echo "=== FIND devtunnel ==="
command -v devtunnel || true
type devtunnel 2>&1 || true
ls -la "$HOME/bin/devtunnel" 2>&1 || true
ls -la "$HOME/.local/bin/devtunnel" 2>&1 || true
find /home/kiran -name 'devtunnel' 2>/dev/null | head -20
find /usr -name 'devtunnel' 2>/dev/null | head -10
# also search windows mount
ls /mnt/c/Users/kiran/.devtunnel*/ 2>&1 | head -5
ls /mnt/c/Program\ Files/Microsoft/*/  2>&1 | head -5
which devtunnel 2>&1 || true
 -r
# try after sourcing bashrc PATH export only
source $HOME/.bashrc 2>/dev/null || true
command -v devtunnel || echo "still missing after bashrc"
devtunnel --version 2>&1 || true
echo "=== GATE: android lint ==="
set +e
pnpm --filter mobily-android lint
echo "android-lint EXIT:$?"