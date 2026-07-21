#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily

ver() {
  local f="$1"
  node -p "require(process.argv[1]).version" "$f"
}

echo "=== Top-level react (not nested) ==="
find . -path '*/node_modules/react/package.json' -not -path '*/node_modules/*/node_modules/react/*' 2>/dev/null | while read -r f; do
  echo "$(ver "$f") $f"
done

echo "=== All react ==="
find . -path '*/node_modules/react/package.json' 2>/dev/null | while read -r f; do
  echo "$(ver "$f") $f"
done

echo "=== Top-level react-dom (not nested) ==="
find . -path '*/node_modules/react-dom/package.json' -not -path '*/node_modules/*/node_modules/react-dom/*' 2>/dev/null | while read -r f; do
  echo "$(ver "$f") $f"
done

echo "=== All react-dom ==="
find . -path '*/node_modules/react-dom/package.json' 2>/dev/null | while read -r f; do
  echo "$(ver "$f") $f"
done

echo "=== find node_modules react/react-dom head 80 ==="
find node_modules -name package.json \( -path '*/react/package.json' -o -path '*/react-dom/package.json' \) 2>/dev/null | head -80

echo "=== ls root react ==="
ls -la node_modules/react node_modules/react-dom 2>&1

echo "=== root versions ==="
node -p "require('./node_modules/react/package.json').version"
node -p "require('./node_modules/react-dom/package.json').version"

echo "=== android node_modules/react ==="
ls -la android/node_modules/react android/node_modules/react-dom 2>&1 || true

echo "=== pnpm react@ ==="
ls -la node_modules/.pnpm 2>/dev/null | rg 'react@' | head -30 || true

echo "=== package.json head ==="
head -40 package.json

echo "=== android package.json react ==="
rg react android/package.json || true

echo "=== lockfile react 19.2.3/6 ==="
rg -n 'react@19\.2\.(3|6)' pnpm-lock.yaml | head -40 || true
echo "=== next compiled react/react-dom ==="
for f in node_modules/next/dist/compiled/react/package.json node_modules/next/dist/compiled/react-dom/package.json; do
  if [ -f "$f" ]; then echo "$(ver "$f") $f"; fi
done

echo "=== pnpm react@ / react-dom@ dirs ==="
ls node_modules/.pnpm 2>/dev/null | grep -E '^react@|^react-dom@' | head -40 || true

echo "=== android package.json react lines ==="
grep -i react android/package.json || true

echo "=== lockfile react@19.2.3/6 ==="
grep -n 'react@19\.2\.\(3\|6\)' pnpm-lock.yaml | head -40 || true

echo "=== android find react/react-dom package.json ==="
find android -path '*/node_modules/react/package.json' 2>/dev/null | while read -r f; do echo "$(ver "$f") $f"; done
find android -path '*/node_modules/react-dom/package.json' 2>/dev/null | while read -r f; do echo "$(ver "$f") $f"; done
