/**
 * The signed-in session (PRD §6.1).
 *
 * One service owns three things that are easy to get subtly wrong if they live
 * apart: who the user is, where the access token goes, and where the refresh
 * token is kept.
 *
 * - The **access token** is short-lived and lives only in memory, pushed into
 *   {@link ApiClient} so every `/api/*` call carries it. It is never written to
 *   storage.
 * - The **refresh token** is the one durable credential, so it goes in
 *   `localStorage` behind an `isPlatformBrowser` guard. The app server-renders;
 *   an unguarded `localStorage` read is a production render crash, not a
 *   warning.
 * - The **role** is only ever what the server last told us. It drives what the
 *   UI offers, never what the API allows — RBAC is enforced server-side
 *   (CLAUDE.md rule 5).
 *
 * Nothing here knows about the Gemini key. That is deliberate: the key lives in
 * `src/app/ai/KeyStore` and only ever travels to Google, so the module that
 * builds authenticated Actuo requests must have no access to it at all
 * (CLAUDE.md rule 2).
 */

import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type {
  AuthSession,
  Expense,
  Page,
  Role,
  SignupRequest,
  User,
} from '@actuo/shared';
import { ApiClient, ApiError } from '../api/api-client.js';

/** Where the rotating refresh token is parked between visits. */
export const REFRESH_TOKEN_STORAGE_KEY = 'actuo.session.refreshToken';

/** What `GET /api/auth/me` returns (backend `AuthenticatedUser`). */
export interface SessionIdentity {
  userId: string;
  orgId: string;
  email: string;
  role?: Role;
}

/**
 * Why an auth attempt failed, in terms the UI can branch on.
 *
 * Branch on `kind`, never on `message` — the copy is tuned for humans and will
 * keep changing.
 */
export type SessionErrorKind =
  | 'credentials'
  | 'conflict'
  | 'validation'
  | 'rate-limited'
  | 'offline'
  | 'server'
  | 'unknown';

/**
 * An auth failure with copy that is already safe to render.
 *
 * Design Doc §3.6: never blame the user. "That email and password don't match
 * an account" describes the lookup; "your password is wrong" accuses someone
 * who may simply be on the wrong tenant.
 */
export class SessionError extends Error {
  constructor(
    override readonly message: string,
    readonly kind: SessionErrorKind,
    readonly status: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SessionError';
  }

  /** True when re-entering credentials is the fix. */
  get credentialProblem(): boolean {
    return this.kind === 'credentials' || this.kind === 'validation';
  }
}

type Intent = 'login' | 'signup' | 'restore' | 'logout';

/** Maps a transport failure onto specific, non-blaming copy. */
export function sessionErrorFrom(error: unknown, intent: Intent): SessionError {
  if (error instanceof SessionError) return error;

  if (!(error instanceof ApiError)) {
    return new SessionError(
      'Something went wrong before the request was sent. Try again.',
      'unknown',
      0,
      error,
    );
  }

  // ApiClient reports an unreachable server, and SSR, as status 0.
  if (error.status === 0) {
    return new SessionError(
      "Actuo didn't respond. Check your connection and try again — nothing was submitted.",
      'offline',
      0,
      error,
    );
  }

  switch (error.status) {
    case 400:
    case 422:
      return new SessionError(
        // The server's validation message is the specific one ("Password must
        // be at least 12 characters."), so prefer it over anything generic.
        error.message || 'Some of those details need another look.',
        'validation',
        error.status,
        error,
      );
    case 401:
      return new SessionError(
        intent === 'login'
          ? "That email and password don't match an Actuo account."
          : 'That session has expired. Sign in again to continue.',
        'credentials',
        401,
        error,
      );
    case 403:
      return new SessionError(
        'That account exists but is not allowed into this workspace.',
        'credentials',
        403,
        error,
      );
    case 409:
      return new SessionError(
        'An account already uses that email address. Sign in instead, or use another address.',
        'conflict',
        409,
        error,
      );
    case 429:
      return new SessionError(
        'Too many attempts from here. Wait a few minutes, then try again.',
        'rate-limited',
        429,
        error,
      );
    default:
      if (error.status >= 500) {
        return new SessionError(
          'Actuo had a problem on its side. Nothing was changed — try again in a moment.',
          'server',
          error.status,
          error,
        );
      }
      return new SessionError(
        error.message || 'That request did not go through.',
        'unknown',
        error.status,
        error,
      );
  }
}

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(ApiClient);

  /** Public so callers can skip session work during SSR. */
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _user = signal<User | null>(null);
  private readonly _orgId = signal<string | null>(null);
  private readonly _role = signal<Role | null>(null);
  private readonly _pendingApprovals = signal(0);
  private readonly _busy = signal(false);
  private readonly _ready = signal(false);

  readonly user = this._user.asReadonly();
  readonly orgId = this._orgId.asReadonly();
  readonly role = this._role.asReadonly();

  /**
   * Count of expenses sitting in `submitted`. Drives the state-gated
   * `approve_expense` tool, which must register only when there is something to
   * approve and deregister when the queue empties (PRD §7).
   */
  readonly pendingApprovals = this._pendingApprovals.asReadonly();

  /** True while a login / signup / restore is in flight. */
  readonly busy = this._busy.asReadonly();

  /**
   * False until `restore()` has finished once. A route guard that redirects on
   * `!isAuthenticated()` before this flips would bounce a returning user to the
   * login screen mid-restore.
   */
  readonly ready = this._ready.asReadonly();

  readonly isAuthenticated = computed(() => this._user() !== null && this._orgId() !== null);

  /** The exact precondition for the state-gated approval tool. */
  readonly canApprove = computed(() => {
    const role = this._role();
    return (role === 'owner' || role === 'admin') && this._pendingApprovals() > 0;
  });

  // --- authentication -------------------------------------------------------

  async login(email: string, password: string): Promise<AuthSession> {
    return this.authenticate(
      '/auth/login',
      { email: email.trim().toLowerCase(), password },
      'login',
    );
  }

  /**
   * Creates a user *and* the organization they will own. Actuo has no
   * join-an-existing-org signup, so `orgName` is required, not optional.
   */
  async signup(request: SignupRequest): Promise<AuthSession> {
    return this.authenticate(
      '/auth/signup',
      {
        email: request.email.trim().toLowerCase(),
        password: request.password,
        name: request.name.trim(),
        orgName: request.orgName.trim(),
      },
      'signup',
    );
  }

  /**
   * Rebuilds the session from the stored refresh token.
   *
   * Resolves `false` rather than throwing for the ordinary "no stored token"
   * and "token no longer valid" cases — a boot-time restore has no user
   * watching it, and a thrown error there is just an unhandled rejection.
   */
  async restore(): Promise<boolean> {
    if (!this.isBrowser) {
      this._ready.set(true);
      return false;
    }

    const refreshToken = this.readRefreshToken();
    if (!refreshToken) {
      this._ready.set(true);
      return false;
    }

    this._busy.set(true);
    try {
      const session = await this.api.post<AuthSession>('/auth/refresh', { refreshToken });
      this.adopt(session);
      await this.confirmIdentity();
      return true;
    } catch (error) {
      // A rejected refresh token is spent — drop it so the next boot is fast.
      // A network blip is not: keep it and let the user retry.
      if (isCredentialRejection(error)) this.forget();
      return false;
    } finally {
      this._busy.set(false);
      this._ready.set(true);
    }
  }

  /**
   * Ends the session. Local state is cleared **first**: if the revoke call
   * fails, the safe outcome is a signed-out browser with a server-side token
   * still live, not a signed-in browser that believes it logged out.
   */
  async logout(): Promise<void> {
    const refreshToken = this.readRefreshToken();
    this.forget();
    if (!refreshToken) return;

    try {
      await this.api.post<{ revoked: boolean }>('/auth/logout', { refreshToken });
    } catch {
      // Best effort. The token is gone from this browser either way.
    }
  }

  /**
   * `GET /api/auth/me` — the server's own answer to "who is this token".
   * Exposed because it is the fastest way to tell a stale token from a broken
   * one when a session misbehaves.
   */
  async me(): Promise<SessionIdentity> {
    return this.api.get<SessionIdentity>('/auth/me');
  }

  // --- derived data ---------------------------------------------------------

  /**
   * Refreshes {@link pendingApprovals} from `GET /api/expenses/search?status=submitted`.
   *
   * Asks for a single row: only `total` is used, and pulling the whole queue to
   * count it would be wasteful on every poll.
   */
  async refreshPendingApprovals(): Promise<number> {
    if (!this.isBrowser || !this.isAuthenticated()) {
      this._pendingApprovals.set(0);
      return 0;
    }

    try {
      const page = await this.api.get<Page<Expense>>('/expenses/search', {
        status: 'submitted',
        limit: 1,
      });
      this._pendingApprovals.set(page.total);
      return page.total;
    } catch {
      // A failed poll must not empty the queue — that would deregister the
      // approval tool on a transient error.
      return this._pendingApprovals();
    }
  }

  // --- internals ------------------------------------------------------------

  private async authenticate(
    path: string,
    body: Record<string, unknown>,
    intent: Intent,
  ): Promise<AuthSession> {
    this._busy.set(true);
    try {
      const session = await this.api.post<AuthSession>(path, body);
      this.adopt(session);
      return session;
    } catch (error) {
      throw sessionErrorFrom(error, intent);
    } finally {
      this._busy.set(false);
      this._ready.set(true);
    }
  }

  /** Takes a fresh `AuthSession` as the new truth. */
  private adopt(session: AuthSession): void {
    this._user.set(session.user);
    this._orgId.set(session.orgId);
    this._role.set(session.role);
    this.api.setAccessToken(session.accessToken);
    this.writeRefreshToken(session.refreshToken);
  }

  /**
   * One authenticated round-trip after a restore.
   *
   * `POST /auth/refresh` is a public route, so a 200 there proves the refresh
   * token was good — not that the access token it minted is accepted by the
   * guard. Clock skew or a rotated signing key shows up here, at boot, instead
   * of on the user's first real action.
   */
  private async confirmIdentity(): Promise<void> {
    try {
      const identity = await this.me();
      this._orgId.set(identity.orgId);
      // `/auth/me` carries no `@Roles()`, so role is absent there by design.
      // Keep the role the refresh response gave us rather than blanking it.
      if (identity.role) this._role.set(identity.role);
    } catch (error) {
      if (isCredentialRejection(error)) {
        this.forget();
        throw sessionErrorFrom(error, 'restore');
      }
      // Offline or a 5xx: the refresh already succeeded, so keep the session.
    }
  }

  /** Wipes every trace of the session from this browser. */
  private forget(): void {
    this._user.set(null);
    this._orgId.set(null);
    this._role.set(null);
    this._pendingApprovals.set(0);
    this.api.setAccessToken(null);
    this.removeRefreshToken();
  }

  // Storage plumbing — SSR- and exception-guarded, like KeyStore's.
  // `localStorage` can throw on *access* when site data is blocked, so even the
  // lookup is inside the try.

  private storage(): Storage | null {
    if (!this.isBrowser) return null;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private readRefreshToken(): string | null {
    try {
      return this.storage()?.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private writeRefreshToken(token: string): void {
    try {
      this.storage()?.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    } catch {
      // Private browsing: the session works for this tab and will not survive
      // a reload. Nothing to recover from here.
    }
  }

  private removeRefreshToken(): void {
    try {
      this.storage()?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      // Nothing more we can do.
    }
  }
}

function isCredentialRejection(error: unknown): boolean {
  if (error instanceof SessionError) return error.status === 401 || error.status === 403;
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
