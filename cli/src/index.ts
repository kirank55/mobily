import { createRequire } from 'node:module';

import { CliLifecycle, createNodeCliLifecycleRuntime } from './cliLifecycle.js';
import { parseCliArgs } from './cliArgs.js';
import { runStation } from './runStation.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const cliLifecycle = new CliLifecycle(createNodeCliLifecycleRuntime());
cliLifecycle.installSignalHandlers();

export async function main(lifecycle: CliLifecycle = cliLifecycle): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2), pkg.version);
  if (parsed.kind === 'done') return;
  await runStation(parsed.options, lifecycle, pkg.version);
}

const verbose = process.argv.includes('--verbose');
process.on('uncaughtException', (error) => {
  void cliLifecycle.fail(error, verbose);
});
process.on('unhandledRejection', (reason) => {
  void cliLifecycle.fail(reason, verbose);
});
void main().catch((error: unknown) => cliLifecycle.fail(error, verbose));
