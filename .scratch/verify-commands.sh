#!/usr/bin/env bash
export PATH="/home/kiran/.nvm/versions/node/v24.14.1/bin:/home/kiran/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily || { echo "CD FAILED"; exit 99; }

LOG=/home/kiran/code-wsl/mobily/.scratch/verify-commands.log
mkdir -p /home/kiran/code-wsl/mobily/.scratch
: > "$LOG"

{
echo "### ENV"
echo "node: $(node --version 2>&1)"
echo "pnpm: $(pnpm --version 2>&1)"
echo "node path: $(command -v node)"
echo "pnpm path: $(command -v pnpm)"

echo ""
echo "### CMD1: pnpm --filter mobily exec vitest run tests/cliArgs.test.ts tests/cliHelp.test.ts"
pnpm --filter mobily exec vitest run tests/cliArgs.test.ts tests/cliHelp.test.ts
echo "### CMD1 EXIT: $?"

echo ""
echo "### CMD2: pnpm --filter mobily-website exec vitest run"
pnpm --filter mobily-website exec vitest run
echo "### CMD2 EXIT: $?"

echo ""
echo "### CMD3: pnpm --filter mobily-android exec vitest run"
pnpm --filter mobily-android exec vitest run
echo "### CMD3 EXIT: $?"

echo ""
echo "### CMD4: pnpm typecheck"
pnpm typecheck
echo "### CMD4 EXIT: $?"

echo ""
echo "### CMD5: pnpm build"
pnpm build
echo "### CMD5 EXIT: $?"

echo ""
echo "### ALL DONE"
} 2>&1 | tee "$LOG"