import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const extensionSource = resolve(import.meta.dirname, 'extension');
const extensionOutput = resolve(import.meta.dirname, 'dist/extension');

function copyExtensionAssets(): Plugin {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      mkdirSync(extensionOutput, { recursive: true });
      cpSync(resolve(extensionSource, 'icons'), resolve(extensionOutput, 'icons'), {
        recursive: true,
      });

      for (const filename of ['background.js', 'THIRD_PARTY_NOTICES.txt']) {
        cpSync(resolve(extensionSource, filename), resolve(extensionOutput, filename));
      }

      const manifest = JSON.parse(
        readFileSync(resolve(extensionSource, 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      manifest.version = '1.3.0';
      manifest.description =
        'A local-first personal workstation for organizing tabs, saved links, and builder updates.';
      writeFileSync(
        resolve(extensionOutput, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  base: './',
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
