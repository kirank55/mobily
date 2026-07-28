#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
export PATH="$HOME/.local/share/pnpm:/usr/local/bin:$PATH"
pnpm install
pnpm --filter @mobily/shared build
pnpm --filter mobily build
pnpm --filter mobily test
cd cli
npm pack --dry-run
node -e '
const pkg = require("./package.json");
const deps = pkg.dependencies || {};
if (Object.values(deps).some((v) => String(v).includes("workspace:"))) {
  console.error("Published dependencies must not use workspace:");
  process.exit(1);
}
if (deps["@mobily/shared"]) {
  console.error("@mobily/shared must be bundled, not a runtime dependency");
  process.exit(1);
}
console.log("package.json publish surface ok:", pkg.name + "@" + pkg.version);
'
