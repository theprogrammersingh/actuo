import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Membership, Role } from '@actuo/shared';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';
// Short TTLs keep the tests fast; the format is the same one .env uses.
process.env.JWT_ACCESS_TTL ||= '15m';
process.env.JWT_REFRESH_TTL ||= '30d';

const { AppModule } = await import('../src/app.module.js');
const { API_PREFIX } = await import('../src/bootstrap.js');
const {
  AUDIT_LOG_REPOSITORY,
  BUDGET_REPOSITORY,
  EXPENSE_REPOSITORY,
  ORG_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  TOOL_CALL_LOG_REPOSITORY,
  USER_REPOSITORY,
} = await import('../src/supabase/repositories.js');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222221';

/**
 * These fakes store what the real tables store — including the refresh-token
 * hash and revocation state — so rotation and reuse detection are exercised
 * for real rather than stubbed away. Only the transport to Postgres is fake.
 */
class FakeUserRepository {
  users = new Map<string, any>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(input: { email: string; name: string; passwordHash: string }) {
    const user = {
      id: USER_ID,
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }
}

class FakeOrgRepository {
  memberships: Membership[] = [];

  async createOrg(input: { name: string; baseCurrency: string }) {
    return {
      id: ORG_ID,
      name: input.name,
      baseCurrency: input.baseCurrency,
      createdAt: new Date().toISOString(),
    };
  }
  async findOrg(orgId: string) {
    return { id: orgId, name: 'Test Org', baseCurrency: 'INR', createdAt: '2026-01-01T00:00:00Z' };
  }
  async createMembership(input: { userId: string; orgId: string; role: Role }) {
    const membership: Membership = {
      id: `m-${this.memberships.length + 1}`,
      ...input,
      joinedAt: new Date().toISOString(),
    };
    this.memberships.push(membership);
    return membership;
  }
  async findMembership(userId: string, orgId: string) {
    return this.memberships.find((m) => m.userId === userId && m.orgId === orgId) ?? null;
  }
  async findFirstMembership(userId: string) {
    return this.memberships.find((m) => m.userId === userId) ?? null;
  }
  async listMembers() {
    return [];
  }
  async listCategories() {
    return [];
  }
  createdCategories: unknown[] = [];
  async createCategories(_orgId: string, categories: unknown[]) {
    this.createdCategories.push(...categories);
    return [];
  }
}

class FakeRefreshTokenRepository {
  rows = new Map<string, any>();

  async create(input: any) {
    const row = { id: input.jti, ...input, revokedAt: null, createdAt: new Date().toISOString() };
    this.rows.set(input.jti, row);
    return row;
  }
  async findByJti(jti: string) {
    return this.rows.get(jti) ?? null;
  }
  async revoke(jti: string, replacedBy: string | null) {
    const row = this.rows.get(jti);
    if (row) Object.assign(row, { revokedAt: new Date().toISOString(), replacedBy });
  }
  async revokeAllForUser(userId: string) {
    for (const row of this.rows.values()) {
      if (row.userId === userId && !row.revokedAt) row.revokedAt = new Date().toISOString();
    }
  }
  get active() {
    return [...this.rows.values()].filter((r) => !r.revokedAt);
  }
}

const notUsed = () => {
  throw new Error('This repository should not be reached by these tests.');
};

describe('auth: signup, login, and refresh-token rotation (PRD §6.1)', () => {
  let app: INestApplication;
  const users = new FakeUserRepository();
  const orgs = new FakeOrgRepository();
  const refreshTokens = new FakeRefreshTokenRepository();

  const url = (path: string) => `${API_PREFIX}${path}`;

  /*
   * A fresh client IP per request.
   *
   * RateLimitGuard is registered globally and buckets by route + client, and
   * the auth routes allow only a handful of attempts per 15 minutes. That is
   * the correct production behaviour, but a test file making a dozen signups
   * from one address would exhaust the bucket and every later assertion would
   * fail as a 429 for reasons unrelated to what it is testing. Varying
   * X-Forwarded-For — the header the guard reads behind a load balancer —
   * isolates each request instead of weakening the limit for everyone.
   *
   * The limiter itself is exercised deliberately in the last test below.
   */
  let clientCounter = 0;
  const freshIp = () => `10.0.0.${(clientCounter += 1) % 250}`;

  const CREDENTIALS = {
    email: 'priya@actuo.demo',
    password: 'correct-horse-battery',
    name: 'Priya Nair',
    orgName: 'Northwind Studio',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(ORG_REPOSITORY)
      .useValue(orgs)
      .overrideProvider(REFRESH_TOKEN_REPOSITORY)
      .useValue(refreshTokens)
      .overrideProvider(AUDIT_LOG_REPOSITORY)
      .useValue({ append: async () => undefined })
      .overrideProvider(EXPENSE_REPOSITORY)
      .useValue({ findById: notUsed, list: notUsed })
      .overrideProvider(BUDGET_REPOSITORY)
      .useValue({ list: notUsed, create: notUsed })
      .overrideProvider(TOOL_CALL_LOG_REPOSITORY)
      .useValue({ append: notUsed, list: notUsed })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    users.users.clear();
    orgs.memberships = [];
    orgs.createdCategories = [];
    refreshTokens.rows.clear();
  });

  // `send()` is typed as string | object, so `unknown` needs narrowing here
  // rather than at every call site.
  const post = (path: string, body: string | object | undefined, ip = freshIp()) =>
    request(app.getHttpServer()).post(url(path)).set('X-Forwarded-For', ip).send(body);

  const signup = () => post('/auth/signup', CREDENTIALS);

  it('creates the user, the org, an owner membership and default categories', async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('priya@actuo.demo');
    expect(res.body.orgId).toBe(ORG_ID);
    expect(res.body.role).toBe('owner');
    expect(orgs.memberships).toHaveLength(1);
    expect(orgs.memberships[0].role).toBe('owner');
    // A brand new org with no categories would make the expense form unusable.
    expect(orgs.createdCategories.length).toBeGreaterThan(0);
  });

  it('never returns the password hash', async () => {
    const res = await signup();
    // The response shape is `User`, not the internal `UserRecord`.
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('stores the password as an argon2id hash, not plaintext', async () => {
    await signup();
    const stored = [...users.users.values()][0];
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(CREDENTIALS.password);
  });

  it('rejects a duplicate email with 409', async () => {
    await signup();
    const res = await signup();
    expect(res.status).toBe(409);
  });

  it('rejects a short password before touching the database', async () => {
    const res = await post('/auth/signup', { ...CREDENTIALS, password: 'short' });
    expect(res.status).toBe(400);
    expect(users.users.size).toBe(0);
  });

  it('logs in with the right password and refuses the wrong one', async () => {
    await signup();

    const ok = await post('/auth/login', {
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();

    const bad = await post('/auth/login', {
      email: CREDENTIALS.email,
      password: 'wrong-password-entirely',
    });
    expect(bad.status).toBe(401);
    // Same message for a wrong password and an unknown account, so login is
    // not an email-enumeration oracle.
    expect(bad.body.message).toBe('Invalid email or password.');

    const unknown = await post('/auth/login', {
      email: 'nobody@actuo.demo',
      password: CREDENTIALS.password,
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(bad.body.message);
  });

  it('rotates the refresh token, revoking the one presented', async () => {
    const session = (await signup()).body;

    const refreshed = await post('/auth/refresh', { refreshToken: session.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);
    // Exactly one live grant: the new one. Rotation replaces, it does not add.
    expect(refreshTokens.active).toHaveLength(1);
  });

  it('treats replay of a rotated token as theft and kills every session', async () => {
    const session = (await signup()).body;
    await post('/auth/refresh', { refreshToken: session.refreshToken });

    const replay = await post('/auth/refresh', { refreshToken: session.refreshToken });

    expect(replay.status).toBe(401);
    // Both the thief's copy and the legitimate client's new token are revoked:
    // there is no way to tell which caller this was, so neither is trusted.
    expect(refreshTokens.active).toHaveLength(0);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const session = (await signup()).body;
    const res = await post('/auth/refresh', { refreshToken: session.accessToken });
    expect(res.status).toBe(401);
  });

  it('logs out idempotently', async () => {
    const session = (await signup()).body;

    const first = await post('/auth/logout', { refreshToken: session.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.revoked).toBe(true);
    expect(refreshTokens.active).toHaveLength(0);

    // A second logout, or one with a garbage token, still succeeds — the
    // client's goal (be logged out) is already true, and a 4xx here would leak
    // whether the token was real.
    const second = await post('/auth/logout', { refreshToken: 'not-a-token' });
    expect(second.status).toBe(200);
    expect(second.body.revoked).toBe(false);
  });

  it('issues a working access token', async () => {
    const session = (await signup()).body;
    const res = await request(app.getHttpServer())
      .get(url('/auth/me'))
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: USER_ID, orgId: ORG_ID, email: CREDENTIALS.email });
    // The role is absent: it is not a token claim, it is resolved from
    // `memberships` by RolesGuard on the routes that need it.
    expect(res.body.role).toBeUndefined();
  });

  it('rate-limits repeated login attempts from one client (PRD §9)', async () => {
    await signup();
    const attacker = '203.0.113.7';

    const statuses: number[] = [];
    // The login window allows 10 per 15 minutes; 12 wrong guesses must not all
    // reach argon2.
    for (let i = 0; i < 12; i += 1) {
      const res = await post(
        '/auth/login',
        { email: CREDENTIALS.email, password: `guess-number-${i}` },
        attacker,
      );
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);

    // Buckets are per client: another address is unaffected.
    const other = await post('/auth/login', {
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
    });
    expect(other.status).toBe(200);
  });
});
