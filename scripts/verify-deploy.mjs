/**
 * Smoke-checks a running deploy.
 *
 * Every check here exists because the thing it checks **failed silently in
 * production** and nobody noticed until someone opened the site by hand:
 *
 *  - SSR fell back to client-side rendering. Angular does not error when the
 *    `Host` header is off its allowlist — it quietly renders on the client and
 *    throws away the SSR and structured-data work. The page still looks fine.
 *  - `__PUBLIC_ORIGIN__` shipped literally in `canonical` and `og:image`,
 *    because the SEO stamp only walked `browser/` while the SSR handler serves
 *    HTML from `server/`. A crawler read a malformed URL, which is worse than a
 *    relative one. `sitemap.xml` looked correct throughout, which is what made
 *    it hard to see.
 *
 * Neither is visible to a unit test, and both are invisible to a casual look at
 * the page. So they are checked here, against the real origin, over the network.
 *
 *   node scripts/verify-deploy.mjs https://actuo.example
 *   pnpm run verify:deploy https://actuo.example
 *
 * Exits non-zero on the first failure, naming what to change.
 */

const SENTINEL = '__PUBLIC_ORIGIN__';
const TIMEOUT_MS = 20_000;

const base = (process.argv[2] ?? process.env.DEPLOY_URL ?? '').trim().replace(/\/+$/, '');
if (!base) {
  console.error('usage: node scripts/verify-deploy.mjs <base-url>');
  process.exit(2);
}

/** A deploy that is merely asleep should read as slow, not as broken. */
async function get(path) {
  const url = `${base}${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { url, status: response.status, body: await response.text() };
}

const failures = [];
const pass = (label, detail) => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, why, fix) => {
  console.log(`  FAIL  ${label} — ${why}`);
  failures.push({ label, why, fix });
};

console.log(`\nVerifying ${base}\n`);

// --- The API answers at all -------------------------------------------------
try {
  const { status, body } = await get('/api/health');
  const ok = status === 200 && JSON.parse(body)?.status === 'ok';
  if (ok) pass('/api/health', '200 ok');
  else fail('/api/health', `status ${status}, body ${body.slice(0, 120)}`, 'The container is not serving Nest. Check the service logs.');
} catch (error) {
  fail('/api/health', String(error), 'The deploy is unreachable, or still waking up.');
}

// --- SSR is actually on -----------------------------------------------------
let home = '';
try {
  const { status, body } = await get('/');
  home = body;
  if (status !== 200) {
    fail('/', `status ${status}`, 'The Angular handler is not answering.');
  } else if (body.includes('ng-server-context')) {
    pass('/', 'server-rendered (ng-server-context present)');
  } else {
    fail(
      '/ server-rendered',
      'no ng-server-context — Angular fell back to client-side rendering',
      'Set NG_ALLOWED_HOSTS on the SERVICE (runtime, not just build) to cover this hostname, e.g. "*.onrender.com". Angular does not error when the Host header is off the list; it silently renders on the client.',
    );
  }
} catch (error) {
  fail('/', String(error), 'The deploy is unreachable.');
}

// --- The SEO stamp reached every copy of the HTML ---------------------------
for (const [path, body] of [['/', home], ['/sitemap.xml', null], ['/robots.txt', null]]) {
  try {
    const text = body ?? (await get(path)).body;
    if (!text) continue;
    if (text.includes(SENTINEL)) {
      fail(
        `${path} stamped`,
        `still contains ${SENTINEL}`,
        'PUBLIC_ORIGIN is a BUILD arg, so a restart cannot fix it — redeploy. If only some paths are affected, scripts/stamp-seo.mjs is not covering the whole dist tree.',
      );
    } else {
      pass(`${path} stamped`, 'no sentinel');
    }
  } catch (error) {
    fail(`${path} stamped`, String(error), 'Could not fetch it.');
  }
}

// --- The converter is configured, and on another origin ---------------------
try {
  const { body } = await get('/api/config');
  const config = JSON.parse(body);
  const url = typeof config?.converterUrl === 'string' ? config.converterUrl : '';
  if (!url) {
    fail(
      '/api/config converterUrl',
      'unset',
      'Set CONVERTER_URL on the service. Unset is a valid state — the converter surfaces say so — but the cross-origin demo will not run.',
    );
  } else if (new URL(url).origin === new URL(base).origin) {
    fail(
      '/api/config converterUrl',
      `same origin as the app (${url})`,
      'It must be an origin the app does not serve, or getTools() returns same-origin tools and the Copilot filters them out.',
    );
  } else {
    pass('/api/config converterUrl', url);
  }
} catch (error) {
  fail('/api/config', String(error), 'Could not read the client config.');
}

// --- Report -----------------------------------------------------------------
if (failures.length === 0) {
  console.log('\nAll checks passed.\n');
  process.exit(0);
}

console.log(`\n${failures.length} check(s) failed:\n`);
for (const { label, fix } of failures) console.log(`  ${label}\n    → ${fix}\n`);
process.exit(1);
