/**
 * Serves the WebMCP partner-demo page on its own origin.
 *
 * PRD §7's cross-origin row needs two origins, not two paths. The page lives in
 * `frontend/public/partner-demo/`, so in dev it is *also* reachable at
 * `localhost:4200/partner-demo/` — but from there it is same-origin, and
 * `normalizeRegisteredTool()` marks its tools `isCrossOrigin: false`, which is
 * exactly the set the Copilot filters out. Nothing about the demo would be
 * cross-origin.
 *
 * So this serves `frontend/public` on :4201, which puts the page at
 * `/partner-demo/` there just as it is on the app's own origin — one URL shape
 * in dev and in production, so `PARTNER_DEMO_ORIGIN` is the only thing that
 * changes between them. Deliberately dependency-free
 * (`node:http` + `node:fs`): a static file server is not worth a package, and
 * every dependency added here is another way for `npm run dev` to fail on a
 * fresh clone, for a process that only exists to serve three static files.
 *
 *   node scripts/partner-server.mjs        # :4201
 *   PORT=5001 node scripts/partner-server.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'frontend/public');
const PORT = Number(process.env.PORT ?? 4201);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Resolve inside ROOT and verify it stayed there: `..` in a URL path is a
  // directory traversal, and this process can read the whole repo.
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const target = join(ROOT, normalize(decodeURIComponent(requested)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      // The page registers tools scoped to Actuo's origin on every load, so a
      // cached copy would keep re-registering against a stale `?actuo=` value.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Partner demo (WebMCP cross-origin) on http://localhost:${PORT}/partner-demo/`);
});
