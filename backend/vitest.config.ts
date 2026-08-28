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
    root: './',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e-spec.ts'],
  },
});
