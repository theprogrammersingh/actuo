import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { canonicalRedirect, requestHost } from './canonical-redirect.js';

const CANONICAL = 'https://actuo.programmersingh.dev';

function run(
  origin: string | undefined,
  req: { method?: string; url?: string; headers?: Record<string, unknown> },
) {
  const redirect = vi.fn();
  const next = vi.fn();
  const middleware = canonicalRedirect(origin);

  middleware(
    { method: 'GET', url: '/', headers: {}, ...req } as unknown as Request,
    { redirect } as unknown as Response,
    next as unknown as NextFunction,
  );

  return {
    redirectedTo: redirect.mock.calls[0]?.[1] as string | undefined,
    status: redirect.mock.calls[0]?.[0] as number | undefined,
    passedThrough: next.mock.calls.length > 0,
  };
}

describe('requestHost', () => {
  it('prefers x-forwarded-host, which is the only true one behind a proxy', () => {
    expect(
      requestHost({
        headers: { host: '10.0.0.7:8080', 'x-forwarded-host': 'actuo.onrender.com' },
      } as unknown as Request),
    ).toBe('actuo.onrender.com');
  });

  it('takes the first entry of a forwarded chain', () => {
    expect(
      requestHost({
        headers: { 'x-forwarded-host': 'actuo.onrender.com, inner.example' },
      } as unknown as Request),
    ).toBe('actuo.onrender.com');
  });

  it('falls back to host when the forwarded header is blank', () => {
    // Blank is absent, not an answer — otherwise a proxy sending an empty
    // header would make every request hostless and skip the redirect.
    expect(
      requestHost({ headers: { host: 'actuo.onrender.com', 'x-forwarded-host': '' } } as unknown as Request),
    ).toBe('actuo.onrender.com');
  });

  it('strips the port and lowercases, so a hostname compares to a hostname', () => {
    expect(requestHost({ headers: { host: 'Actuo.OnRender.com:443' } } as unknown as Request)).toBe(
      'actuo.onrender.com',
    );
  });

  it('is empty when nothing says', () => {
    expect(requestHost({ headers: {} } as unknown as Request)).toBe('');
  });
});

describe('canonicalRedirect', () => {
  it('sends another hostname to the canonical origin, keeping path and query', () => {
    const { status, redirectedTo } = run(CANONICAL, {
      url: '/agent?tab=tools',
      headers: { host: 'actuo.onrender.com' },
    });

    expect(status).toBe(308);
    expect(redirectedTo).toBe('https://actuo.programmersingh.dev/agent?tab=tools');
  });

  it('leaves the canonical hostname alone', () => {
    const { passedThrough } = run(CANONICAL, {
      headers: { host: 'actuo.programmersingh.dev' },
    });
    expect(passedThrough).toBe(true);
  });

  it('ignores the port when comparing', () => {
    const { passedThrough } = run(CANONICAL, {
      headers: { host: 'actuo.programmersingh.dev:443' },
    });
    expect(passedThrough).toBe(true);
  });

  it.each(['localhost', 'localhost:4200', '127.0.0.1', '::1', '[::1]', '[::1]:8080'])(
    'never redirects %s',
    (host) => {
      // `node server.mjs` locally must not bounce to production. The IPv6 forms
      // are here because a blanket port-strip turns `::1` into `:`, which
      // matches no loopback entry and redirects.
      const { passedThrough } = run(CANONICAL, { headers: { host } });
      expect(passedThrough).toBe(true);
    },
  );

  it.each(['POST', 'PATCH', 'DELETE'])('does not redirect %s', (method) => {
    // A redirected write is a replayed body, and nothing that mutates should
    // depend on which hostname it was addressed to.
    const { passedThrough } = run(CANONICAL, { method, headers: { host: 'actuo.onrender.com' } });
    expect(passedThrough).toBe(true);
  });

  it('is a pass-through when no origin is configured', () => {
    // On a host that passes PUBLIC_ORIGIN only as a build arg it is absent at
    // runtime; serving every host beats guessing at a canonical one.
    for (const origin of [undefined, '', '   ']) {
      expect(run(origin, { headers: { host: 'actuo.onrender.com' } }).passedThrough).toBe(true);
    }
  });

  it('is a pass-through, and says why, when the origin is not a URL', () => {
    const onDisabled = vi.fn();
    const middleware = canonicalRedirect('actuo.programmersingh.dev', onDisabled);
    const next = vi.fn();

    middleware(
      { method: 'GET', url: '/', headers: { host: 'actuo.onrender.com' } } as unknown as Request,
      { redirect: vi.fn() } as unknown as Response,
      next as unknown as NextFunction,
    );

    // A bare hostname has no scheme, so `new URL` throws. Failing open is the
    // safe direction; failing silently is not.
    expect(next).toHaveBeenCalled();
    expect(onDisabled).toHaveBeenCalledOnce();
  });

  it('builds the target from the configured origin, never from the request', () => {
    // The guard against this becoming an open redirect: a hostile Host header
    // decides only *whether* to redirect, never where to.
    const { redirectedTo } = run(CANONICAL, {
      url: '/',
      headers: { host: 'evil.example.com', 'x-forwarded-host': 'evil.example.com' },
    });

    expect(redirectedTo).toBe('https://actuo.programmersingh.dev/');
  });

  it('does not redirect when no hostname can be determined', () => {
    const { passedThrough } = run(CANONICAL, { headers: {} });
    expect(passedThrough).toBe(true);
  });
});
