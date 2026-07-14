import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: { __DEV__: true },
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      'expo-modules-core': path.join(root, 'tests/expoModulesCoreStub.ts'),
    },
  },
  test: { environment: 'node', restoreMocks: true },
});
