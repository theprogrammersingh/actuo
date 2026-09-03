/**
 * Smoke-checks a running deploy.
 *
 * Every check here failed silently in production at least once: SSR quietly
 * downgraded to client-side rendering, and `__PUBLIC_ORIGIN__` shipped
 * unstamped. Neither is visible to a unit test or to a glance at the page.
 *
 *   pnpm run verify:deploy https://actuo.example
 *
 * Exits non-zero on failure, naming what to change.
 */

const SENTINEL = '__PUBLIC_ORIGIN__';

/** Not a failure: the check does not apply to this origin. */
class Skip extends Error {}
const TIMEOUT_MS = 20_000;

const base = (process.argv[2] ?? process.env.DEPLOY_URL ?? '').trim().replace(/\/+$/, '');
if (!base) {
  console.error('usage: node scripts/verify-deploy.mjs <base-url>');
  process.exit(2);
}

async function get(path, { follow = true } = {}) {
  const url = `${base}${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // `manual` is how an alias origin is caught: fetch follows redirects by
    // default, so every check below would silently describe the canonical
    // origin while claiming to describe this one.
    redirect: follow ? 'follow' : 'manual',
  });
  return {
    url,
    status: response.status,
    location: response.headers.get('location'),
    body: await response.text(),
  };
}

/** The absolute URL the SEO stamp wrote into each file, or null. */
function stampedUrl(path, text) {
  const pattern = {
    '/': /<link rel="canonical" href="([^"]+)"/,
    '/sitemap.xml': /<loc>([^<]+)<\/loc>/,
    '/robots.txt': /^Sitemap:\s*(\S+)/m,
  }[path];
  return pattern ? (pattern.exec(text)?.[1] ?? null) : null;
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

// --- Is this the canonical origin, or an alias that redirects to it? --------
let isAlias = false;
try {
  const { status, location } = await get('/', { follow: false });
  if (status >= 300 && status < 400 && location) {
    isAlias = true;
    const target = new URL(location, base).origin;
    pass('/ canonical redirect', `${status} -> ${target}`);
    console.log(`\n  This origin is an alias. Run the checks below against ${target}.\n`);
  }
} catch (error) {
  fail('/ canonical redirect', String(error), 'Could not fetch it.');
}

// --- SSR is actually on -----------------------------------------------------
let home = '';
try {
  if (isAlias) throw new Skip();
  const { status, body } = await get('/');
  home = body;
  /*
   * 400            -> host allowlist  -> NG_ALLOWED_HOSTS
   * 200 without it -> proxy headers   -> trustProxyHeaders
   */
  if (status === 400) {
    fail(
      '/ server-rendered',
      `status 400 — the host allowlist rejected "${new URL(base).hostname}"`,
      'Add this hostname to NG_ALLOWED_HOSTS on the service (a comma-separated list; "*.example.com" matches by suffix). It is checked at runtime, so a restart is enough.',
    );
  } else if (status !== 200) {
    fail('/', `status ${status}`, 'The Angular handler is not answering.');
  } else if (body.includes('ng-server-context')) {
    pass('/', 'server-rendered (ng-server-context present)');
  } else {
    fail(
      '/ server-rendered',
      'no ng-server-context — a 200 that was rendered on the client',
      'The proxy is sending an x-forwarded-* header Angular does not trust, so it downgraded to CSR. frontend/src/server.ts passes the full set to AngularNodeAppEngine, so if this fails the deploy predates that fix — redeploy — or NG_TRUST_PROXY_HEADERS is set on the service and is too narrow. The service logs name the exact header: "Received \"x-...\" header but trustProxyHeaders was not set up to allow it".',
    );
  }
} catch (error) {
  if (!(error instanceof Skip)) fail('/', String(error), 'The deploy is unreachable.');
}

// --- The SEO stamp reached every copy of the HTML ---------------------------
for (const [path, body] of [['/', home], ['/sitemap.xml', null], ['/robots.txt', null]]) {
  if (isAlias) break;
  try {
    const text = body ?? (await get(path)).body;
    if (!text) continue;
    if (text.includes(SENTINEL)) {
      fail(
        `${path} stamped`,
        `still contains ${SENTINEL}`,
        'PUBLIC_ORIGIN is a BUILD arg, so a restart cannot fix it — redeploy. If only some paths are affected, scripts/stamp-seo.mjs is not covering the whole dist tree.',
      );
      continue;
    }

    /*
     * A missing sentinel only proves something was substituted, not that the
     * right thing was. With a custom domain attached, the stamp kept naming the
     * old origin on every page the new one served — canonical, og:image and
     * <loc> all pointing somewhere else, which no other check here noticed.
     */
    const stamped = stampedUrl(path, text);
    if (stamped && new URL(stamped).origin !== new URL(base).origin) {
      fail(
        `${path} stamped`,
        `names ${new URL(stamped).origin}, not ${new URL(base).origin}`,
        'PUBLIC_ORIGIN is set to a different origin than the one being verified. It is a BUILD arg, so change it and REDEPLOY — a restart cannot reach prerendered HTML.',
      );
    } else {
      pass(`${path} stamped`, stamped ? `names ${new URL(stamped).origin}` : 'no sentinel');
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
