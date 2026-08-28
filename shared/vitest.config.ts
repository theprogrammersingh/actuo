import { defineConfig } from 'vitest/config';

/**
 * Tests run under Node and may use `node:fs` (the page-limit guard scans the
 * source tree). The build tsconfig deliberately sets `types: []` so nothing in
 * `src/` can reach for `process`, `window` or `Buffer` — this package ships to
 * both a browser bundle and a Node server. Specs are excluded from that build
 * and typechecked only here, which keeps the guard rail intact.
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.spec.ts'],
  },
});
