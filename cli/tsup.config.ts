import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  // Workspace package — bundle so `node dist` does not need pnpm symlinks at runtime.
  noExternal: ['@mobily/shared'],
});
