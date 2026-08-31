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
const STAMPABLE = new Set(['.html', '.xml', '.txt', '.webmanifest', '.json']);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BROWSER_DIST = join(ROOT, 'frontend/dist/frontend/browser');

/** Trailing slashes would double up against the leading slash of every path. */
const origin = (process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (STAMPABLE.has(extname(entry.name))) yield path;
  }
}

if (!existsSync(BROWSER_DIST)) {
  console.error(`[seo] ${BROWSER_DIST} is missing. Run \`pnpm run build\` first.`);
  process.exit(1);
}

let files = 0;
let occurrences = 0;
for await (const path of walk(BROWSER_DIST)) {
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
