#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$HOME/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily

echo "=== node ==="
node -v

echo "=== pnpm why react (root) ==="
pnpm why react 2>&1 | head -60 || true

echo "=== pnpm why react (android) ==="
(cd android && pnpm why react 2>&1 | head -60) || true

echo "=== react package.json files ==="
find . -path '*/node_modules/react/package.json' 2>/dev/null | sort

echo "=== react versions ==="
while IFS= read -r f; do
  v=$(node -p "require('$f').version" 2>/dev/null || echo '?')
  echo "$v  $f"
done < <(find . -path '*/node_modules/react/package.json' 2>/dev/null | sort)

echo "=== react-dom versions ==="
while IFS= read -r f; do
  v=$(node -p "require('$f').version" 2>/dev/null || echo '?')
  echo "$v  $f"
done < <(find . -path '*/node_modules/react-dom/package.json' 2>/dev/null | sort)

echo "=== expo export web (45s timeout) ==="
cd android
timeout 45 npx expo export --platform web --output-dir /tmp/mobily-web-export 2>&1 | tail -100 || true
echo "EXPORT_EXIT:$?"
