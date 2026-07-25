#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily
# use grep -R since rg may be missing
echo "=== Connected Successfully ==="
grep -Rn "Connected Successfully" cli/src --include='*.ts' || true
echo "=== attaching workstation ==="
grep -Rn "attaching workstation\|Phone connected\|attach-session\|attachWorkstation\|workstation" cli/src --include='*.ts' | head -80
echo "=== files of interest ==="
ls cli/src/**/*workstation* 2>/dev/null
ls cli/src/**/*tmux* 2>/dev/null
find cli/src -iname '*workstation*' -o -iname '*tmux*' -o -iname '*attach*' 2>/dev/null | head -40