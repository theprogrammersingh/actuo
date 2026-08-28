import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Approval, Expense, ExpenseStatus, Membership, Role } from '@actuo/shared';

/*
 * Secrets must be in process.env BEFORE AppModule is imported, because
 * importing it pulls in ConfigModule. @nestjs/config only copies a .env value
 * into process.env when the key is not already set, so these win over the
 * blank ones in backend/.env — which is exactly how a developer with real
 * credentials and a CI run with none both work.
 */
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

const { AppModule } = await import('../src/app.module.js');
const { API_PREFIX } = await import('../src/bootstrap.js');
const {
  AUDIT_LOG_REPOSITORY,
  EXPENSE_REPOSITORY,
  ORG_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  TOOL_CALL_LOG_REPOSITORY,
  USER_REPOSITORY,
  BUDGET_REPOSITORY,
} = await import('../src/supabase/repositories.js');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '11111111-1111-4111-8111-1111111111ff';
const OWNER_ID = '22222222-2222-4222-8222-222222222221';
const ADMIN_ID = '22222222-2222-4222-8222-222222222223';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const OUTSIDER_ID = '22222222-2222-4222-8222-2222222222ff';
const EXPENSE_ID = '66666666-6666-4666-8666-000000000002';

/**
 * In-memory stand-ins for the repository interfaces.
 *
 * This is the payoff of the repository seam: the test exercises the real
 * guards, the real controller routing, the real state machine and the real
 * ValidationPipe, with only the database swapped out. Nothing here mocks a
 * guard or stubs a role — if RolesGuard stopped consulting `memberships`,
 * these tests would go green for the wrong reason and the assertions on the
 * *reason* strings would catch it.
 */
class FakeOrgRepository {
  /** (userId -> role) for ORG_ID. Anyone absent is not a member. */
  roles = new Map<string, Role>([
    [OWNER_ID, 'owner'],
    [ADMIN_ID, 'admin'],
    [MEMBER_ID, 'member'],
  ]);

  findMembership(userId: string, orgId: string): Promise<Membership | null> {
    const role = orgId === ORG_ID ? this.roles.get(userId) : undefined;
    if (!role) return Promise.resolve(null);
    return Promise.resolve({
      id: `membership-${userId}`,
      userId,
      orgId,
      role,
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  findOrg = async (orgId: string) => ({
    id: orgId,
    name: 'Northwind Studio',
    baseCurrency: 'INR',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  findFirstMembership = async () => null;
  createOrg = async () => {
    throw new Error('not used');
  };
  createMembership = async () => {
    throw new Error('not used');
  };
  listMembers = async () => [];
  listCategories = async () => [];
  createCategories = async () => [];
}

class FakeExpenseRepository {
  expenses = new Map<string, Expense>();
  approvals: Approval[] = [];

  reset(status: ExpenseStatus = 'submitted', userId = MEMBER_ID): void {
    this.expenses.clear();
    this.approvals = [];
    this.expenses.set(EXPENSE_ID, {
      id: EXPENSE_ID,
      orgId: ORG_ID,
      userId,
      categoryId: null,
      amount: 6450,
      currency: 'INR',
      convertedAmount: 6450,
      baseCurrency: 'INR',
      merchant: 'Uber',
      note: 'Airport transfer',
      status,
      receiptUrl: null,
      expenseDate: '2026-08-20',
      createdAt: '2026-08-20T00:00:00.000Z',
      deletedAt: null,
    });
  }

  async findById(orgId: string, id: string): Promise<Expense | null> {
    const expense = this.expenses.get(id);
    // Mirrors the real query, which filters on org_id and deleted_at.
    if (!expense || expense.orgId !== orgId || expense.deletedAt) return null;
    return expense;
  }

  async list(orgId: string, query: any) {
    const items = [...this.expenses.values()].filter(
      (e) => e.orgId === orgId && !e.deletedAt && (!query.userId || e.userId === query.userId),
    );
    return { items, total: items.length, limit: query.limit, offset: query.offset };
  }

  async update(orgId: string, id: string, patch: any): Promise<Expense> {
    const existing = this.expenses.get(id)!;
    const updated = { ...existing, ...patch };
    this.expenses.set(id, updated);
    return updated;
  }

  async softDelete(_orgId: string, id: string): Promise<void> {
    const existing = this.expenses.get(id)!;
    this.expenses.set(id, { ...existing, deletedAt: new Date().toISOString() });
  }

  async sumByCategory() {
    return [];
  }

  async create(input: any): Promise<Expense> {
    const expense: Expense = {
      id: '66666666-6666-4666-8666-0000000000aa',
      convertedAmount: null,
      merchant: null,
      note: null,
      receiptUrl: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      ...input,
    };
    this.expenses.set(expense.id, expense);
    return expense;
  }

  async recordApproval(input: any): Promise<Approval> {
    const approval: Approval = {
      id: `approval-${this.approvals.length + 1}`,
      expenseId: input.expenseId,
      approverId: input.approverId,
      status: input.status,
      comment: input.comment,
      decidedAt: new Date().toISOString(),
    };
    this.approvals.push(approval);
    return approval;
  }
}

const notUsed = () => {
  throw new Error('This repository should not be reached by these tests.');
};

describe('RBAC is enforced server-side (PRD §9 / CLAUDE.md rule 5)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const orgs = new FakeOrgRepository();
  const expenses = new FakeExpenseRepository();
  const auditEntries: unknown[] = [];

  /** A genuine, correctly-signed access token — the guard really verifies it. */
  const tokenFor = (userId: string, orgId = ORG_ID) =>
    jwt.sign(
      { sub: userId, email: `${userId}@actuo.demo`, org: orgId, typ: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET },
    );

  const url = (path: string) => `${API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Every repository token is overridden, so nothing in this test can
      // reach Supabase even by accident.
      .overrideProvider(ORG_REPOSITORY)
      .useValue(orgs)
      .overrideProvider(EXPENSE_REPOSITORY)
      .useValue(expenses)
      .overrideProvider(AUDIT_LOG_REPOSITORY)
      .useValue({ append: async (entry: unknown) => void auditEntries.push(entry) })
      .overrideProvider(USER_REPOSITORY)
      .useValue({ findByEmail: notUsed, findById: notUsed, create: notUsed })
      .overrideProvider(REFRESH_TOKEN_REPOSITORY)
      .useValue({ create: notUsed, findByJti: notUsed, revoke: notUsed, revokeAllForUser: notUsed })
      .overrideProvider(TOOL_CALL_LOG_REPOSITORY)
      .useValue({ append: notUsed, list: notUsed })
      .overrideProvider(BUDGET_REPOSITORY)
      .useValue({ list: async () => [], create: notUsed })
      .compile();

    app = moduleRef.createNestApplication();
    // Same prefix and pipe configuration as bootstrap.ts, so route shapes and
    // validation behaviour match production rather than the test harness.
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    expenses.reset('submitted', MEMBER_ID);
    auditEntries.length = 0;
  });

  describe('POST /api/expenses/:id/approve', () => {
    it('rejects a member with 403 — the headline RBAC guarantee', async () => {
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(MEMBER_ID)}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('member');
      // Refused before the handler ran: the expense is untouched and no
      // decision was recorded.
      expect(expenses.expenses.get(EXPENSE_ID)?.status).toBe('submitted');
      expect(expenses.approvals).toHaveLength(0);
    });

    it('allows an admin, moving submitted -> approved', async () => {
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`)
        .send({ comment: 'Client onsite, pre-agreed.' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(expenses.approvals).toHaveLength(1);
      expect(expenses.approvals[0]).toMatchObject({
        approverId: ADMIN_ID,
        status: 'approved',
        comment: 'Client onsite, pre-agreed.',
      });
    });

    it('allows an owner', async () => {
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
    });

    it('rejects an unauthenticated caller with 401, not 403', async () => {
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .send({});
      expect(res.status).toBe(401);
    });

    it('rejects a forged token', async () => {
      const forged = jwt.sign(
        { sub: ADMIN_ID, email: 'x@y.z', org: ORG_ID, typ: 'access' },
        { secret: 'not-the-real-secret' },
      );
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${forged}`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('ignores a role claim smuggled into the token', async () => {
      // The whole point of resolving the role from `memberships`: a client that
      // mints (or is handed) a token asserting `role: 'owner'` gains nothing,
      // because nothing downstream reads that claim.
      const smuggled = jwt.sign(
        { sub: MEMBER_ID, email: 'm@actuo.demo', org: ORG_ID, typ: 'access', role: 'owner' },
        { secret: process.env.JWT_ACCESS_SECRET },
      );
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${smuggled}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('member');
    });

    it('rejects an authenticated user who is not a member of the org', async () => {
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not a member');
    });

    it('will not let an admin approve their own expense', async () => {
      expenses.reset('submitted', ADMIN_ID);
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('your own expense');
    });

    it('returns 409 for an illegal transition, and leaves the row alone', async () => {
      expenses.reset('draft', MEMBER_ID);
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.from).toBe('draft');
      expect(res.body.to).toBe('approved');
      expect(res.body.allowed).toEqual(['submitted']);
      expect(expenses.expenses.get(EXPENSE_ID)?.status).toBe('draft');
    });

    it('stops a valid token pointed at an org the user does not belong to', async () => {
      // The token is genuine and the user is a real admin — but of a different
      // org. RolesGuard finds no membership for (user, org) and refuses, so a
      // tampered-with `org` claim buys nothing.
      const res = await request(app.getHttpServer())
        .post(url(`/expenses/${EXPENSE_ID}/approve`))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID, OTHER_ORG_ID)}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not a member');
    });
  });

  describe('PATCH /api/expenses/:id is not a back door around the state machine', () => {
    it('rejects a member setting status to approved', async () => {
      const res = await request(app.getHttpServer())
        .patch(url(`/expenses/${EXPENSE_ID}`))
        .set('Authorization', `Bearer ${tokenFor(MEMBER_ID)}`)
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
      expect(expenses.expenses.get(EXPENSE_ID)?.status).toBe('submitted');
    });

    it('rejects an illegal status jump even for an owner', async () => {
      expenses.reset('draft', MEMBER_ID);
      const res = await request(app.getHttpServer())
        .patch(url(`/expenses/${EXPENSE_ID}`))
        .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
        .send({ status: 'reimbursed' });

      expect(res.status).toBe(409);
      expect(expenses.expenses.get(EXPENSE_ID)?.status).toBe('draft');
    });
  });

  describe('member-scoped reads', () => {
    it('shows a member only their own expenses', async () => {
      expenses.reset('submitted', OWNER_ID); // an expense the member did not file
      const res = await request(app.getHttpServer())
        .get(url('/expenses'))
        .set('Authorization', `Bearer ${tokenFor(MEMBER_ID)}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('shows an admin the whole org', async () => {
      expenses.reset('submitted', MEMBER_ID);
      const res = await request(app.getHttpServer())
        .get(url('/expenses'))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('routes GET /expenses/search to search, not to the :id handler', async () => {
      // Declaration order in the controller is what makes this pass; if the
      // :id route were declared first, this would 400 on an invalid UUID.
      const res = await request(app.getHttpServer())
        .get(url('/expenses/search?query=uber&limit=5'))
        .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.limit).toBe(5);
    });
  });

  describe('budgets', () => {
    it('lets a member read, but not create', async () => {
      const read = await request(app.getHttpServer())
        .get(url('/budgets'))
        .set('Authorization', `Bearer ${tokenFor(MEMBER_ID)}`);
      expect(read.status).toBe(200);

      const write = await request(app.getHttpServer())
        .post(url('/budgets'))
        .set('Authorization', `Bearer ${tokenFor(MEMBER_ID)}`)
        .send({ amount: 1000 });
      expect(write.status).toBe(403);
    });
  });

  describe('public surface', () => {
    it('serves GET /api/config without a token', async () => {
      const res = await request(app.getHttpServer()).get(url('/config'));
      expect(res.status).toBe(200);
      expect(res.body.geminiModels.map((m: { id: string }) => m.id)).toEqual([
        'gemini-3-pro',
        'gemini-3-flash',
        'gemini-2.5-flash',
      ]);
      expect(res.body.baseCurrency).toBe('INR');

      // The LLM boundary, asserted rather than assumed: no key of any kind may
      // appear in what this service hands the browser (CLAUDE.md rule 2).
      expect(JSON.stringify(res.body)).not.toMatch(/api[_-]?key/i);
    });

    it('requires a token for GET /api/expenses', async () => {
      const res = await request(app.getHttpServer()).get(url('/expenses'));
      expect(res.status).toBe(401);
    });
  });
});
