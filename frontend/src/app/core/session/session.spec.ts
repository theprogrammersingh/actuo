import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AuthSession } from '@actuo/shared';

import { ApiClient, ApiError } from '../api/api-client.js';
import { REFRESH_TOKEN_STORAGE_KEY, Session, SessionError } from './session.js';

const SESSION: AuthSession = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  user: {
    id: 'user-1',
    email: 'priya@actuo.demo',
    name: 'Priya Sharma',
    createdAt: '2026-01-04T09:00:00.000Z',
  },
  orgId: 'org-1',
  role: 'owner',
};

const ROTATED: AuthSession = {
  ...SESSION,
  accessToken: 'access-token-2',
  refreshToken: 'refresh-token-2',
};

interface Recorded {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  params?: Record<string, unknown>;
}

/**
 * A stand-in for `ApiClient` that records everything and answers from a table.
 * Nothing in this file touches the network.
 */
class FakeApi {
  readonly calls: Recorded[] = [];
  readonly tokens: Array<string | null> = [];
  readonly routes = new Map<string, () => unknown>();

  setAccessToken(token: string | null): void {
    this.tokens.push(token);
  }

  get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: 'GET', path, params });
    return this.answer<T>(`GET ${path}`);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'POST', path, body });
    return this.answer<T>(`POST ${path}`);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'PATCH', path, body });
    return this.answer<T>(`PATCH ${path}`);
  }

  delete<T>(path: string): Promise<T> {
    this.calls.push({ method: 'DELETE', path });
    return this.answer<T>(`DELETE ${path}`);
  }

  on(key: string, handler: () => unknown): this {
    this.routes.set(key, handler);
    return this;
  }

  paths(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path}`);
  }

  private async answer<T>(key: string): Promise<T> {
    const handler = this.routes.get(key);
    if (!handler) throw new ApiError(`No stub for ${key}`, 404, null);
    return handler() as T;
  }
}

function makeSession(api: FakeApi, platform: 'browser' | 'server' = 'browser'): Session {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: ApiClient, useValue: api as unknown as ApiClient },
    ],
  });
  return TestBed.inject(Session);
}

describe('Session', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('adopts the server session and hands the access token to ApiClient', async () => {
      api.on('POST /auth/login', () => SESSION);
      const session = makeSession(api);

      await session.login('Priya@Actuo.Demo', 'Demo1234!');

      expect(session.isAuthenticated()).toBe(true);
      expect(session.user()?.name).toBe('Priya Sharma');
      expect(session.orgId()).toBe('org-1');
      expect(session.role()).toBe('owner');
      expect(api.tokens).toEqual(['access-token-1']);
    });

    it('normalizes the email, because the backend lower-cases it too', async () => {
      api.on('POST /auth/login', () => SESSION);
      const session = makeSession(api);

      await session.login('  Priya@Actuo.Demo  ', 'Demo1234!');

      expect(api.calls[0]?.body).toEqual({ email: 'priya@actuo.demo', password: 'Demo1234!' });
    });

    it('persists only the refresh token — never the access token', async () => {
      api.on('POST /auth/login', () => SESSION);
      const session = makeSession(api);

      await session.login('priya@actuo.demo', 'Demo1234!');

      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-token-1');
      expect(JSON.stringify(localStorage)).not.toContain('access-token-1');
    });

    it('reports bad credentials specifically, without blaming the user', async () => {
      api.on('POST /auth/login', () => {
        throw new ApiError('Unauthorized', 401, null);
      });
      const session = makeSession(api);

      const error = await session.login('priya@actuo.demo', 'nope').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SessionError);
      const failure = error as SessionError;
      expect(failure.kind).toBe('credentials');
      expect(failure.message).toBe("That email and password don't match an Actuo account.");
      expect(failure.message).not.toMatch(/\byour password\b/i);
      expect(session.isAuthenticated()).toBe(false);
    });

    it('distinguishes rate limiting from a wrong password', async () => {
      api.on('POST /auth/login', () => {
        throw new ApiError('Too Many Requests', 429, null);
      });
      const session = makeSession(api);

      const error = (await session.login('priya@actuo.demo', 'x').catch((e) => e)) as SessionError;

      expect(error.kind).toBe('rate-limited');
      expect(error.message).toContain('Wait a few minutes');
    });

    it('reports an unreachable server as offline, and says nothing was submitted', async () => {
      api.on('POST /auth/login', () => {
        throw new ApiError('offline', 0, null);
      });
      const session = makeSession(api);

      const error = (await session.login('priya@actuo.demo', 'x').catch((e) => e)) as SessionError;

      expect(error.kind).toBe('offline');
      expect(error.message).toContain('nothing was submitted');
    });

    it('clears `busy` whether the attempt succeeds or fails', async () => {
      api.on('POST /auth/login', () => {
        throw new ApiError('Unauthorized', 401, null);
      });
      const session = makeSession(api);

      await session.login('priya@actuo.demo', 'x').catch(() => undefined);

      expect(session.busy()).toBe(false);
    });
  });

  describe('signup', () => {
    it('sends the org name alongside the user, and adopts the session', async () => {
      api.on('POST /auth/signup', () => SESSION);
      const session = makeSession(api);

      await session.signup({
        email: ' Priya@Actuo.Demo ',
        password: 'a-long-enough-password',
        name: ' Priya ',
        orgName: ' Northwind Design ',
      });

      expect(api.calls[0]?.body).toEqual({
        email: 'priya@actuo.demo',
        password: 'a-long-enough-password',
        name: 'Priya',
        orgName: 'Northwind Design',
      });
      expect(session.isAuthenticated()).toBe(true);
    });

    it('turns a duplicate email into an actionable conflict message', async () => {
      api.on('POST /auth/signup', () => {
        throw new ApiError('Conflict', 409, null);
      });
      const session = makeSession(api);

      const error = (await session
        .signup({ email: 'a@b.co', password: 'x'.repeat(12), name: 'A', orgName: 'B' })
        .catch((e) => e)) as SessionError;

      expect(error.kind).toBe('conflict');
      expect(error.message).toContain('Sign in instead');
    });

    it('passes the server validation message through, since it is the specific one', async () => {
      api.on('POST /auth/signup', () => {
        throw new ApiError('Password must be at least 12 characters.', 400, null);
      });
      const session = makeSession(api);

      const error = (await session
        .signup({ email: 'a@b.co', password: 'short', name: 'A', orgName: 'B' })
        .catch((e) => e)) as SessionError;

      expect(error.kind).toBe('validation');
      expect(error.message).toBe('Password must be at least 12 characters.');
    });
  });

  describe('restore', () => {
    it('does nothing and reports ready when there is no stored token', async () => {
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(false);
      expect(api.calls).toEqual([]);
      expect(session.ready()).toBe(true);
    });

    it('exchanges the refresh token and confirms the access token with /auth/me', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api
        .on('POST /auth/refresh', () => ROTATED)
        .on('GET /auth/me', () => ({
          userId: 'user-1',
          orgId: 'org-1',
          email: 'priya@actuo.demo',
        }));
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(true);

      expect(api.paths()).toEqual(['POST /auth/refresh', 'GET /auth/me']);
      expect(api.calls[0]?.body).toEqual({ refreshToken: 'refresh-token-1' });
      expect(session.isAuthenticated()).toBe(true);
      expect(session.ready()).toBe(true);
    });

    it('stores the rotated refresh token, so the old one is never replayed', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api
        .on('POST /auth/refresh', () => ROTATED)
        .on('GET /auth/me', () => ({ userId: 'user-1', orgId: 'org-1', email: 'p@a.co' }));
      const session = makeSession(api);

      await session.restore();

      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-token-2');
      expect(api.tokens).toEqual(['access-token-2']);
    });

    it('keeps the role from the refresh response, which /auth/me does not carry', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api
        .on('POST /auth/refresh', () => ROTATED)
        .on('GET /auth/me', () => ({ userId: 'user-1', orgId: 'org-1', email: 'p@a.co' }));
      const session = makeSession(api);

      await session.restore();

      expect(session.role()).toBe('owner');
    });

    it('drops a rejected refresh token instead of retrying it every boot', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'expired');
      api.on('POST /auth/refresh', () => {
        throw new ApiError('Unauthorized', 401, null);
      });
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(false);

      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
      expect(session.isAuthenticated()).toBe(false);
    });

    it('keeps the token when the failure was the network, not the credential', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api.on('POST /auth/refresh', () => {
        throw new ApiError('offline', 0, null);
      });
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(false);

      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-token-1');
    });

    it('survives a flaky /auth/me: the refresh already succeeded', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api
        .on('POST /auth/refresh', () => ROTATED)
        .on('GET /auth/me', () => {
          throw new ApiError('Service Unavailable', 503, null);
        });
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(true);
      expect(session.isAuthenticated()).toBe(true);
    });

    it('signs out when /auth/me rejects the freshly minted access token', async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token-1');
      api
        .on('POST /auth/refresh', () => ROTATED)
        .on('GET /auth/me', () => {
          throw new ApiError('Unauthorized', 401, null);
        });
      const session = makeSession(api);

      await expect(session.restore()).resolves.toBe(false);

      expect(session.isAuthenticated()).toBe(false);
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    });
  });

  describe('logout', () => {
    it('revokes the stored token and clears every signal', async () => {
      api.on('POST /auth/login', () => SESSION).on('POST /auth/logout', () => ({ revoked: true }));
      const session = makeSession(api);
      await session.login('priya@actuo.demo', 'Demo1234!');

      await session.logout();

      expect(api.calls.at(-1)).toMatchObject({
        path: '/auth/logout',
        body: { refreshToken: 'refresh-token-1' },
      });
      expect(session.isAuthenticated()).toBe(false);
      expect(session.user()).toBeNull();
      expect(session.role()).toBeNull();
      expect(session.pendingApprovals()).toBe(0);
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
      expect(api.tokens.at(-1)).toBeNull();
    });

    it('still signs out locally when the revoke call fails', async () => {
      api.on('POST /auth/login', () => SESSION).on('POST /auth/logout', () => {
        throw new ApiError('offline', 0, null);
      });
      const session = makeSession(api);
      await session.login('priya@actuo.demo', 'Demo1234!');

      await expect(session.logout()).resolves.toBeUndefined();

      expect(session.isAuthenticated()).toBe(false);
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    });

    it('makes no call when there was nothing stored', async () => {
      const session = makeSession(api);

      await session.logout();

      expect(api.calls).toEqual([]);
    });
  });

  describe('pending approvals (drives the state-gated approve_expense tool)', () => {
    async function signedIn(): Promise<Session> {
      api.on('POST /auth/login', () => SESSION);
      const session = makeSession(api);
      await session.login('priya@actuo.demo', 'Demo1234!');
      return session;
    }

    it('reads the total from the submitted-status search', async () => {
      const session = await signedIn();
      api.on('GET /expenses/search', () => ({ items: [], total: 3, limit: 1, offset: 0 }));

      await expect(session.refreshPendingApprovals()).resolves.toBe(3);

      expect(session.pendingApprovals()).toBe(3);
      expect(api.calls.at(-1)?.params).toEqual({ status: 'submitted', limit: 1 });
    });

    it('gates approval on role AND a non-empty queue', async () => {
      const session = await signedIn();
      expect(session.canApprove()).toBe(false); // owner, but nothing pending

      api.on('GET /expenses/search', () => ({ items: [], total: 2, limit: 1, offset: 0 }));
      await session.refreshPendingApprovals();

      expect(session.canApprove()).toBe(true);
    });

    it('holds the last known count when a poll fails, rather than emptying the queue', async () => {
      const session = await signedIn();
      api.on('GET /expenses/search', () => ({ items: [], total: 4, limit: 1, offset: 0 }));
      await session.refreshPendingApprovals();

      api.on('GET /expenses/search', () => {
        throw new ApiError('offline', 0, null);
      });
      await expect(session.refreshPendingApprovals()).resolves.toBe(4);
      expect(session.pendingApprovals()).toBe(4);
    });

    it('reports zero and makes no call when signed out', async () => {
      const session = makeSession(api);

      await expect(session.refreshPendingApprovals()).resolves.toBe(0);
      expect(api.calls).toEqual([]);
    });
  });

  describe('server-side rendering', () => {
    it('never touches localStorage', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const session = makeSession(api, 'server');

      await session.restore();

      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    });

    it('reports not-authenticated and ready, so the shell can render the shell', async () => {
      const session = makeSession(api, 'server');

      await expect(session.restore()).resolves.toBe(false);

      expect(session.isAuthenticated()).toBe(false);
      expect(session.ready()).toBe(true);
      expect(session.isBrowser).toBe(false);
    });

    it('skips the approvals poll entirely', async () => {
      const session = makeSession(api, 'server');

      await expect(session.refreshPendingApprovals()).resolves.toBe(0);
      expect(api.calls).toEqual([]);
    });
  });

  describe('hostile storage (private browsing, blocked site data)', () => {
    it('signs in anyway when localStorage refuses to write', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      api.on('POST /auth/login', () => SESSION);
      const session = makeSession(api);

      await expect(session.login('priya@actuo.demo', 'Demo1234!')).resolves.toBeDefined();
      expect(session.isAuthenticated()).toBe(true);
    });
  });
});
