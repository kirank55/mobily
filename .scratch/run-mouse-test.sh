#!/usr/bin/env bash
set -eu
source ~/.nvm/nvm.sh
cd /home/kiran/code-wsl/mobily
fail=0
for i in $(seq 1 30); do
  if ! pnpm --filter mobily exec vitest run tests/queuedMouseReports.integration.test.ts -t "clean exit" 2>&1 | grep -q "1 passed"; then
    echo "FAIL run $i"
    fail=$((fail + 1))
  fi
done
echo "Failures: $fail/30"
