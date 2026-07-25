#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PNPM_HOME="/home/kiran/.local/share/pnpm"
export PATH="${PNPM_HOME}:/home/kiran/bin:${PATH}"
cd /home/kiran/code-wsl/mobily
set +e
echo "=== GATE: build ==="
pnpm build
echo "build EXIT:$?"
echo "=== GATE: @mobily/shared test ==="
pnpm --filter @mobily/shared test
echo "shared-test EXIT:$?"
echo "=== GATE: mobily test ==="
pnpm --filter mobily test
echo "mobily-test EXIT:$?"
echo "=== GATE: mobily-android vitest ==="
pnpm --filter mobily-android exec vitest run
echo "android-vitest EXIT:$?"