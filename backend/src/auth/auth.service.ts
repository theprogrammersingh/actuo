import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { AuthSession, Role, User } from '@actuo/shared';
import { EnvService } from '../config/env.service.js';
import { durationToMs } from '../common/duration.js';
import {
  AUDIT_LOG_REPOSITORY,
  ORG_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  USER_REPOSITORY,
  type AuditLogRepository,
  type OrgRepository,
  type RefreshTokenRepository,
  type UserRecord,
  type UserRepository,
} from '../supabase/repositories.js';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types.js';

/** Seeded into every new org so the first expense has somewhere to go. */
const DEFAULT_CATEGORIES = [
  { name: 'Travel', icon: 'plane', isDefault: true },
  { name: 'Meals', icon: 'utensils', isDefault: true },
  { name: 'Software', icon: 'laptop', isDefault: true },
  { name: 'Office Supplies', icon: 'box', isDefault: true },
  { name: 'Marketing', icon: 'megaphone', isDefault: true },
  { name: 'Training', icon: 'book', isDefault: true },
];

/**
 * `expiresIn` is typed by `ms` as a template-literal union (`\`${number}m\``
 * and friends), which a value read from `process.env` can never satisfy — the
 * compiler only sees `string`. The format is validated by `durationToMs()`,
 * which parses the same value for the `refresh_tokens.expires_at` column and
 * falls back to a sane default on garbage.
 */
type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;
const ttl = (value: string) => value as ExpiresIn;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP's argon2id baseline
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /**
   * Signup creates four things at once: the user, their organization, an
   * `owner` membership, and the default category set.
   *
   * Supabase's PostgREST API cannot wrap those in one transaction, so this is a
   * best-effort sequence. It is ordered so a failure leaves the least damage:
   * user first (the unique email index is the real guard against duplicates),
   * then org, then membership. A crash between org and membership orphans an
   * empty org row, which is invisible to the user and harmless. Doing it the
   * other way round could leave a user who cannot log in anywhere.
   */
  async signup(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
    userAgent: string | null;
  }): Promise<AuthSession> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictException('An account with that email already exists.');
    }

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const user = await this.users.create({
      email: input.email,
      name: input.name,
      passwordHash,
    });

    const org = await this.orgs.createOrg({
      name: input.orgName,
      baseCurrency: this.env.baseCurrency,
    });
    await this.orgs.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
    await this.orgs.createCategories(org.id, DEFAULT_CATEGORIES);

    await this.safeAudit({
      orgId: org.id,
      actorId: user.id,
      action: 'org.created',
      entity: 'organization',
      entityId: org.id,
      metadata: { name: org.name },
    });

    return this.issueSession(user, org.id, 'owner', input.userAgent);
  }

  async login(input: {
    email: string;
    password: string;
    userAgent: string | null;
  }): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);

    /*
     * Uniform failure, uniform timing.
     *
     * When the email does not exist there is no stored hash to verify, so a
     * naive implementation returns in microseconds while a real account takes
     * argon2's full cost — a timing oracle for enumerating registered emails.
     * Verifying against a throwaway hash spends comparable work either way, and
     * both branches return the same message.
     */
    if (!user) {
      await this.burnTime(input.password);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) throw new UnauthorizedException('Invalid email or password.');

    const membership = await this.orgs.findFirstMembership(user.id);
    if (!membership) {
      // A user with no org cannot do anything in a multi-tenant app; every
      // endpoint scopes by org. Better an explicit 401 than a session whose
      // every subsequent request 403s.
      throw new UnauthorizedException('This account is not a member of any organization.');
    }

    return this.issueSession(user, membership.orgId, membership.role, input.userAgent);
  }

  /**
   * Refresh-token rotation (PRD §6.1).
   *
   * Every refresh mints a new token and revokes the presented one, so a token
   * is single-use. If a revoked token is presented again, that means two
   * parties hold the same token — the legitimate client and a thief — and
   * there is no way to tell which one this is. So every session for that user
   * is killed and both are forced to log in again. Noisy on purpose; a stolen
   * refresh token is otherwise a month-long silent session.
   */
  async refresh(refreshToken: string, userAgent: string | null): Promise<AuthSession> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.env.requireRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Wrong token type.');
    }

    const stored = await this.refreshTokens.findByJti(payload.jti);
    if (!stored) throw new UnauthorizedException('Refresh token not recognised.');

    if (stored.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId} (jti ${payload.jti}); ` +
          'revoking all sessions.',
      );
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token has already been used.');
    }

    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired.');
    }

    // The stored hash is checked too, not just the jti: it binds this exact
    // token string to the row, so a forged JWT carrying a known jti is useless.
    if (stored.tokenHash !== hashToken(refreshToken)) {
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token mismatch.');
    }

    const user = await this.users.findById(stored.userId);
    if (!user) throw new UnauthorizedException('Account no longer exists.');

    const membership = await this.orgs.findMembership(stored.userId, stored.orgId);
    if (!membership) {
      // Removed from the org since the token was issued.
      await this.refreshTokens.revoke(payload.jti, null);
      throw new UnauthorizedException('You are no longer a member of this organization.');
    }

    const { session, jti } = await this.issueGrant(user, stored.orgId, membership.role, userAgent);
    // Link old -> new so the token chain is walkable when investigating a
    // reuse alert.
    await this.refreshTokens.revoke(payload.jti, jti);
    return session;
  }

  /** Revokes one session. A refresh token that will not verify is already dead. */
  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.env.requireRefreshSecret(),
      });
      await this.refreshTokens.revoke(payload.jti, null);
      return { revoked: true };
    } catch {
      // Idempotent by design: logging out twice, or with a stale token, is a
      // success from the client's point of view. Never leak whether the token
      // was real.
      return { revoked: false };
    }
  }

  // -------------------------------------------------------------------------

  private async issueSession(
    user: UserRecord,
    orgId: string,
    role: Role,
    userAgent: string | null,
  ): Promise<AuthSession> {
    return (await this.issueGrant(user, orgId, role, userAgent)).session;
  }

  /**
   * Mints an access/refresh pair and persists the refresh grant.
   *
   * Returns the new `jti` alongside the session because rotation needs to
   * record which token replaced which — recovering it by decoding the JWT we
   * just signed would be a pointless round trip.
   */
  private async issueGrant(
    user: UserRecord,
    orgId: string,
    role: Role,
    userAgent: string | null,
  ): Promise<{ session: AuthSession; jti: string }> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      org: orgId,
      typ: 'access',
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.env.requireAccessSecret(),
      expiresIn: ttl(this.env.accessTtl),
    });

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      org: orgId,
      jti,
      typ: 'refresh',
    };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.env.requireRefreshSecret(),
      expiresIn: ttl(this.env.refreshTtl),
    });

    const ttlMs = durationToMs(this.env.refreshTtl, 30 * 86_400_000);
    await this.refreshTokens.create({
      jti,
      userId: user.id,
      orgId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      userAgent,
    });

    return {
      session: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
        orgId,
        // The client gets its role so the UI can hide what it must not show.
        // This is presentation only — the server re-derives it from the
        // database on every gated request (RolesGuard).
        role,
      },
      jti,
    };
  }

  /**
   * Audit writes must never fail a request that otherwise succeeded — a user
   * who just created their account should not see a 500 because a log insert
   * hiccupped.
   */
  private async safeAudit(entry: Parameters<AuditLogRepository['append']>[0]): Promise<void> {
    try {
      await this.audit.append(entry);
    } catch (error) {
      this.logger.warn(`Audit write failed for ${entry.action}: ${(error as Error).message}`);
    }
  }

  private async burnTime(password: string): Promise<void> {
    try {
      await argon2.hash(password, ARGON2_OPTIONS);
    } catch {
      /* the work is the point, not the result */
    }
  }
}

/**
 * A refresh token is a bearer credential, so the database stores only a digest
 * of it. SHA-256 rather than argon2 deliberately: the token is 128 bits of
 * random jti inside a signed JWT, not a guessable human password, so there is
 * nothing for a slow hash to defend against — and refresh runs on a hot path.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Strips `passwordHash` before anything crosses the wire. */
function toPublicUser(user: UserRecord): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
