#!/bin/bash
set -e
export PATH="/usr/local/bin:/usr/bin:$HOME/.local/share/pnpm:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  LATEST=$(ls "$HOME/.nvm/versions/node" | tail -1)
  export PATH="$HOME/.nvm/versions/node/$LATEST/bin:$PATH"
fi
NEWPATH=""
IFS=':'
for p in $PATH; do
  case "$p" in
    /mnt/c/*) ;;
    *) NEWPATH="${NEWPATH:+$NEWPATH:}$p" ;;
  esac
done
unset IFS
export PATH="$NEWPATH"
echo "node: $(command -v node || echo MISSING)"
echo "pnpm: $(command -v pnpm || echo MISSING)"
node -v 2>/dev/null || true
cd /home/kiran/code-wsl/mobily/android
if [ -x ./node_modules/.bin/vitest ]; then
  ./node_modules/.bin/vitest run tests/pairing.test.ts
  EC=$?
elif [ -x ../node_modules/.bin/vitest ]; then
  ../node_modules/.bin/vitest run tests/pairing.test.ts
  EC=$?
elif command -v pnpm >/dev/null 2>&1; then
  pnpm exec vitest run tests/pairing.test.ts
  EC=$?
else
  echo "No vitest runner found"
  EC=127
fi
echo EXIT:$EC
exit $EC
