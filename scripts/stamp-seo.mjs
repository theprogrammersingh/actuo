/**
 * Stamps the public origin into the built output.
 *
 * The public pages are **prerendered**, so anything absolute has to be decided
 * at build time — there is no request to read a Host header from, and a URL
 * baked in during prerendering would otherwise say `localhost`. And absolute is
 * not optional: the sitemap spec requires a full URL in `<loc>`, and most
 * scrapers will not resolve a relative `og:image`.
 *
 * So `index.html`, `sitemap.xml` and `robots.txt` carry a `__PUBLIC_ORIGIN__`
 * sentinel, and this replaces it everywhere in the build output. The sentinel
 * survives prerendering into every generated HTML file, so one pass covers all
 * of them rather than each page needing its own handling.
 *
 * **It has to be the whole `dist/frontend` tree, not just `browser/`.** This
 * walked only `browser/` once, and the deployed site shipped a literal
 * `__PUBLIC_ORIGIN__` in its `canonical` and `og:image`: Angular keeps its own
 * copies of the page HTML under `server/` — `index.server.html` and the
 * `assets-chunks/*.mjs` templates, `index_csr_html.mjs` among them — and those
 * are what the SSR handler serves. `sitemap.xml` and `robots.txt` looked right
 * throughout, because they are served from `browser/`, which is exactly what
 * made it hard to see. A crawler reading a malformed URL is worse than one
 * reading a relative URL, so this must not narrow again.
 *
 * With PUBLIC_ORIGIN unset it substitutes the empty string, leaving every URL
 * root-relative and still valid — a local build is never broken by an
 * unconfigured domain, it just loses the absolute forms.
 *
 *   PUBLIC_ORIGIN=https://actuo.example node scripts/stamp-seo.mjs
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = '__PUBLIC_ORIGIN__';
/**
 * `.mjs` is here for `server/assets-chunks/*.mjs` — Angular inlines each page's
 * HTML into a JS module, sentinel and all. Stamping a string constant inside a
 * generated module is safe: the sentinel appears nowhere else in the output.
 */
const STAMPABLE = new Set(['.html', '.xml', '.txt', '.webmanifest', '.json', '.mjs']);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** The whole build output: `browser/` is served statically, `server/` is rendered from. */
const DIST = join(ROOT, 'frontend/dist/frontend');

/** Trailing slashes would double up against the leading slash of every path. */
const origin = (process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (STAMPABLE.has(extname(entry.name))) yield path;
  }
}

if (!existsSync(DIST)) {
  console.error(`[seo] ${DIST} is missing. Run \`pnpm run build\` first.`);
  process.exit(1);
}

let files = 0;
let occurrences = 0;
for await (const path of walk(DIST)) {
  const before = await readFile(path, 'utf8');
  if (!before.includes(SENTINEL)) continue;
  occurrences += before.split(SENTINEL).length - 1;
  await writeFile(path, before.replaceAll(SENTINEL, origin));
  files += 1;
}

console.log(
  origin
    ? `[seo] stamped ${occurrences} URLs across ${files} files with ${origin}`
    : `[seo] PUBLIC_ORIGIN is unset — left ${occurrences} URLs across ${files} files relative`,
);
