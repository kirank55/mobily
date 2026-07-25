#!/bin/bash
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd /home/kiran/code-wsl/mobily/cli
echo "=== @mobily/shared matches ==="
rg -n "@mobily/shared" dist/index.js | head -20 || true
echo "=== first import/require lines ==="
rg -n "^(import |const .* = require|require\()" dist/index.js | head -40 || true
echo "=== also from / require containing shared ==="
rg -n "from |require\(" dist/index.js | head -40 || true
echo "---"
node -e 'const fs=require("fs"); const t=fs.readFileSync("dist/index.js","utf8"); console.log("count", (t.match(/@mobily\/shared/g)||[]).length); console.log(t.slice(0,800));'
