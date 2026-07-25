#!/usr/bin/env bash
set -u
cd /home/kiran/code-wsl/mobily
export PATH="$HOME/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
exec pnpm --filter mobily exec node dist/index.js --tunnel devtunnels --verbose --session mobily-dt-shell