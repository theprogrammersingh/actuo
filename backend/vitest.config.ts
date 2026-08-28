import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [
    tsconfigPaths(),
    /*
     * Required for Nest's dependency injection under test.
     *
     * Nest resolves constructor dependencies from the `design:paramtypes`
     * metadata that TypeScript emits when `emitDecoratorMetadata` is on.
     * Vitest transforms with esbuild, which does NOT emit that metadata, so
     * every injected dependency arrives as `undefined` and the failure surfaces
     * far from its cause ("Cannot read properties of undefined"). SWC emits it.
     *
     * `nest build` is unaffected — it uses tsc, which honours the tsconfig.
     */
    swc.vite({ module: { type: 'es6' } }),
  ],
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
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e-spec.ts'],
  },
});
