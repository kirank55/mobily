import { spawnSync } from 'node:child_process';
const r = spawnSync(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    'tests/browser/terminalSnapshot.pw.mjs',
    '--grep',
    'keyboard|focused cursor|initial grid|one finger|vertical swipe',
    '--reporter=line',
    '--timeout=60000',
  ],
  { cwd: '/home/kiran/code-wsl/mobily/android', encoding: 'utf8', env: process.env },
);
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);