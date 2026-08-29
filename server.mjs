/**
 * The production entry point: one Node process serving both halves of Actuo.
 *
 * `backend/src/main.ts` listens on :3000 standalone for local development,
 * behind the Angular dev server's proxy. This file is the other caller of
 * `createNestApp()` — same Nest app, same routing, composed with the Angular
 * SSR handler on `$PORT`. Both go through `createNestApp()` precisely so local
 * and production cannot drift apart on routing.
 *
 * ## Why appending the handler is the whole trick
 *
 * `createNestApp()` calls `setGlobalPrefix('/api')`, which scopes Nest's
 * not-found router to `/api` instead of installing a global catch-all. So the
 * single Express instance behind Nest answers `/api/*` itself — including
 * unknown ones, with JSON — and matches nothing outside `/api`, which falls
 * through to whatever middleware was registered after it. That is the Angular
 * handler.
 *
 * Both halves of that are pinned by `backend/test/routing-contract.e2e-spec.ts`.
 * If this file ever starts returning the app shell for a bad `/api` call, or
 * a JSON 404 for a real page, that spec is where the reason will be.
 *
 * The Angular SSR bundle is self-contained (its only imports are `node:`
 * builtins — Express is bundled into it) and it serves `dist/browser` itself,
 * so there is nothing to configure here and no dependency to install at the
 * repository root.
 *
 *   pnpm run build && node server.mjs      # PORT defaults to 8080
 */

const PORT = Number(process.env.PORT ?? 8080);

/** Loads a build artifact, or explains that the build has not been run. */
async function loadBuilt(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `[actuo] ${what} is missing (${specifier}). Run \`pnpm run build\` first — ` +
          'it builds shared, then backend, then frontend, in that order.',
        { cause: error },
      );
    }
    throw error;
  }
}

const { createNestApp } = await loadBuilt('./backend/dist/bootstrap.js', 'the backend build');
const { reqHandler } = await loadBuilt(
  './frontend/dist/frontend/server/server.mjs',
  'the frontend SSR build',
);

const nest = await createNestApp();

/*
 * `createNodeRequestHandler` returns the handler it was given, unchanged, with
 * metadata attached — so `reqHandler` is the Angular server's Express app and
 * is usable directly as `(req, res, next)` middleware. Registered after Nest's
 * routes, it is the fallback for everything that is not `/api/*`: static assets
 * from `dist/browser`, then server-side rendering.
 */
nest.getHttpAdapter().getInstance().use(reqHandler);

// 0.0.0.0, not the default localhost: a container that binds the loopback
// interface passes its own health check and is unreachable from outside.
await nest.listen(PORT, '0.0.0.0');
console.log(`[actuo] listening on http://0.0.0.0:${PORT} — /api/* is Nest, everything else is Angular`);
