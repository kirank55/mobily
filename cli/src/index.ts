import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(): Promise<void> {
  console.log(`mobily v${pkg.version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
