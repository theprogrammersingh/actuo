import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  // See vitest.config.ts — SWC is what makes Nest's DI work under vitest.
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    /*
     * Absolute, not './'.
     *
     * A relative root is resolved against process.cwd(), so running the
     * documented `npx vitest run --root backend` from the repo root left the
     * root at the monorepo and `include: ['**\/*.spec.ts']` swept up
     * frontend/'s specs too — which then fail for unrelated reasons and bury
     * the backend result. Anchoring to this file's own directory makes the
     * command mean the same thing from anywhere.
     */
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.e2e-spec.ts'],
  },
});
