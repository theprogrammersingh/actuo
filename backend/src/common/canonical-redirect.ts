import type { NextFunction, Request, Response } from 'express';

/**
 * Sends page requests arriving on any other hostname to the canonical one.
 *
 * Two origins serving identical pages is duplicate content, and only one of
 * them can be the `canonical` the prerendered HTML names — so the other has to
 * point at it rather than answer 200 alongside it. Actuo answers on both
 * `actuo.onrender.com` and `actuo.programmersingh.dev`.
 *
 * It lives in `backend/` rather than beside `server.mjs` for one reason: this is
 * the only place with a test runner that can reach it. `server.mjs` imports it
 * from `backend/dist`, the same way it already imports `createNestApp`.
 */

/** Local hostnames never redirect, mirroring `angular.json`'s own allowlist. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The hostname a request believes it arrived on, lowercased and without a port.
 *
 * `x-forwarded-host` wins because behind Render's proxy `host` is the internal
 * address — the same header Angular's allowlist reads. A blank one falls
 * through to `host` rather than counting as an answer, and a comma-joined
 * forwarded chain takes its first entry.
 */
export function requestHost(req: Pick<Request, 'headers'>): string {
  const forwarded = req.headers['x-forwarded-host'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const raw = (first || req.headers.host || '').trim();
  return stripPort(raw).toLowerCase();
}

/**
 * `NG_ALLOWED_HOSTS` as a list, parsed the way Angular parses it.
 *
 * Mirrors `getArrayFromEnv` in `@angular/ssr`: split on `,`, trim, drop empties.
 */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether Angular would serve this hostname — mirrors its `isHostAllowed`.
 *
 * `*` allows everything; otherwise an exact match, or a suffix match for a
 * `*.` entry (`hostname.endsWith('.example.com')`, which deliberately does not
 * cover the bare apex).
 */
export function isHostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.includes('*') || allowedHosts.includes(hostname)) return true;
  return allowedHosts.some(
    (entry) => entry.startsWith('*.') && hostname.endsWith(entry.slice(1)),
  );
}

/**
 * Drops a trailing `:port`, without mangling an IPv6 literal.
 *
 * A blanket `/:\d+$/` turns `::1` into `:`, which then matches no loopback
 * entry and redirects. Bracketed IPv6 (`[::1]:8080`) is the form a Host header
 * is supposed to use, but the bare one shows up too.
 */
function stripPort(host: string): string {
  if (host.startsWith('[')) return host.replace(/^(\[[^\]]*\]):\d+$/, '$1');
  // More than one colon means a bare IPv6 literal, which carries no port.
  if (host.split(':').length > 2) return host;
  return host.replace(/:\d+$/, '');
}

/**
 * Express middleware redirecting to `canonicalOrigin`, or a pass-through when
 * there is none.
 *
 * **`/api` can never reach this**, and that is placement rather than a check:
 * `server.mjs` registers it after Nest, whose `setGlobalPrefix('/api')` scopes
 * the not-found router to `/api` so every `/api/*` request is answered before
 * anything downstream sees it — Render's `/api/health` probe included.
 * `test/routing-contract.e2e-spec.ts` is what pins that.
 *
 * An unparseable or absent origin disables it entirely. That is the right
 * default: on a host that passes `PUBLIC_ORIGIN` only as a `--build-arg` it
 * does not exist at runtime, and serving every host beats guessing at one.
 *
 * 308 rather than 302 so the two origins consolidate for crawlers. The cost is
 * that browsers cache it hard: if the canonical domain's DNS or certificate
 * ever lapses, a visitor holding the redirect cannot fall back to the other
 * hostname. Worth knowing before changing `PUBLIC_ORIGIN`.
 *
 * It also changes what an UNKNOWN host sees. Running ahead of Angular's
 * allowlist, this redirects anything non-canonical, so a host on neither list
 * gets a 308 here instead of Angular's 400 — the two guards compose rather than
 * one replacing the other, and `NG_ALLOWED_HOSTS` still governs the canonical
 * host itself. Not an open redirect: the target is always built from the
 * configured origin, never from the request.
 */
export function canonicalRedirect(
  canonicalOrigin: string | undefined,
  allowedHostsEnv: string | undefined,
  onDisabled?: (reason: string) => void,
): (req: Request, res: Response, next: NextFunction) => void {
  let canonical: URL | null = null;
  const configured = canonicalOrigin?.trim();

  if (configured) {
    try {
      canonical = new URL(configured);
    } catch {
      onDisabled?.(`PUBLIC_ORIGIN is not a URL (${configured}); canonical redirect disabled.`);
    }
  }

  /*
   * The guard against the one misconfiguration that takes the whole site down.
   *
   * PUBLIC_ORIGIN naming a host that NG_ALLOWED_HOSTS does not cover means the
   * alias 308s to a host Angular answers 400 for: every page dead, while
   * `/api/health` still returns 200 so Render reports a healthy deploy and
   * never rolls back. Refusing to redirect degrades that to "both hosts keep
   * serving", which is merely wrong rather than down.
   *
   * This re-implements Angular's matcher, and that duplication is safe in one
   * direction only — which is the direction that matters. The check can only
   * ever DISABLE a redirect: if it drifts and wrongly says "allowed" the
   * behaviour is what it would have been without the guard at all, and if it
   * wrongly says "not allowed" the site still serves on every host. It cannot
   * make anything worse than not having it. Angular's own list stays the
   * authority on what gets served; this only decides whether to redirect.
   *
   * An unset NG_ALLOWED_HOSTS lands here too, correctly: Angular then allows
   * only angular.json's localhost/127.0.0.1, so a canonical host would 400.
   */
  if (canonical) {
    const allowedHosts = parseAllowedHosts(allowedHostsEnv);
    if (!isHostAllowed(canonical.hostname, allowedHosts)) {
      onDisabled?.(
        `PUBLIC_ORIGIN host "${canonical.hostname}" is not covered by NG_ALLOWED_HOSTS ` +
          `(${allowedHostsEnv?.trim() || 'unset'}); canonical redirect disabled. ` +
          'Redirecting to a host Angular answers 400 for would take every page down. ' +
          'Add it to NG_ALLOWED_HOSTS to enable the redirect.',
      );
      canonical = null;
    }
  }

  return (req, res, next) => {
    if (!canonical) return next();
    // Only GET/HEAD: a redirected POST is a replayed body, and nothing that
    // mutates should depend on which hostname it was addressed to.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const host = requestHost(req);
    if (!host || host === canonical.hostname || LOOPBACK.has(host)) return next();

    res.redirect(308, new URL(req.originalUrl ?? req.url, canonical).toString());
  };
}
