import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * **Do not add `/api` routes here.**
 *
 * The Angular scaffold suggests it, and it would be wrong for this app: `/api`
 * belongs to NestJS, which enforces auth and RBAC before any data is touched
 * (CLAUDE.md rule 1). In production the two are composed by `server.mjs` at the
 * repository root, which appends this file's exported `reqHandler` after Nest's
 * routes — so anything defined here would shadow nothing and duplicate a
 * boundary that is deliberately server-side.
 *
 * In development the Angular dev server proxies `/api` to Nest on :3000 and
 * this file does not run at all. It is the standalone SSR entry the builder
 * requires, and the source of the handler `server.mjs` mounts.
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start standalone only when run directly — SSR with no API behind it, which is
 * useful for isolating a rendering problem from the composed process. The real
 * entry point is `node server.mjs` at the repository root; imported from there,
 * `isMainModule` is false and this block does not run.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * The handler the Angular CLI uses for the dev server and prerendering — and
 * the one `server.mjs` mounts after Nest in production.
 *
 * `createNodeRequestHandler` returns what it is given, unchanged, with metadata
 * attached; so this is the Express app above and works directly as
 * `(req, res, next)` middleware.
 */
export const reqHandler = createNodeRequestHandler(app);
