/**
 * The repository seam.
 *
 * Business logic (auth, expenses, budgets) depends on these interfaces, never
 * on `SupabaseClient`. Two things fall out of that:
 *
 *  1. Tests are honest and fast. The RBAC e2e test overrides these tokens with
 *     in-memory fakes, so it proves the *guard* works rather than proving a
 *     database connection works. No live Supabase, no network.
 *  2. The Supabase-shaped details (snake_case columns, PostgREST error codes,
 *     `.is('deleted_at', null)`) stay in one directory instead of leaking into
 *     every service.
 *
 * Interfaces vanish at runtime, so each one has a matching injection token
 * below. Inject with `@Inject(EXPENSE_REPOSITORY)`.
 */

import type {
  Approval,
  Budget,
  Category,
  Expense,
  ExpenseStatus,
  Membership,
  Organization,
  Page,
  Role,
  AuditLogEntry,
  ToolCallLogEntry,
} from '@actuo/shared';

// Records that exist server-side only

/**
 * A user row *including* the password hash.
 *
 * Deliberately not the shared `User` type: `@actuo/shared` is compiled into
 * the browser bundle, and `passwordHash` must never appear in a type that
 * crosses the wire. AuthService strips it before responding.
 */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

/** A stored refresh-token grant. Only the jti and a hash are persisted. */
export interface RefreshTokenRecord {
  id: string;
  jti: string;
  userId: string;
  orgId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
}

export interface CategorySpendRow {
  categoryId: string | null;
  /** Sum of rows that have a value in the org's base currency. */
  total: number;
  /**
   * Rows skipped because they are in another currency and `converted_amount`
   * is null. Carried up to `BudgetStatus.unconvertedCount` so the figure can
   * say what it left out instead of adding foreign amounts as if they were
   * base-currency ones.
   */
  unconverted: number;
}

export interface ExpenseQuery {
  /** Free text matched against merchant and note. */
  query?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  /** Restrict to one submitter — how a `member` sees only their own rows. */
  userId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface CreateExpenseInput {
  orgId: string;
  userId: string;
  categoryId: string | null;
  amount: number;
  currency: string;
  convertedAmount: number | null;
  baseCurrency: string;
  merchant: string | null;
  note: string | null;
  expenseDate: string;
  status: ExpenseStatus;
}

export type UpdateExpenseInput = Partial<
  Pick<
    Expense,
    | 'categoryId'
    | 'amount'
    | 'currency'
    | 'convertedAmount'
    | 'merchant'
    | 'note'
    | 'expenseDate'
    | 'status'
    | 'receiptUrl'
  >
>;

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

export interface AppendToolCallInput {
  orgId: string;
  actorId: string | null;
  actor: 'human' | 'agent';
  toolName: string;
  input: unknown;
  output: unknown;
}

// Interfaces

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: { email: string; name: string; passwordHash: string }): Promise<UserRecord>;
}

export interface OrgRepository {
  createOrg(input: { name: string; baseCurrency: string }): Promise<Organization>;
  findOrg(orgId: string): Promise<Organization | null>;
  createMembership(input: { userId: string; orgId: string; role: Role }): Promise<Membership>;
  /** The RBAC lookup. Returns null when the user is not in that org at all. */
  findMembership(userId: string, orgId: string): Promise<Membership | null>;
  /** Used at login to pick the active org when the client did not name one. */
  findFirstMembership(userId: string): Promise<Membership | null>;
  listMembers(orgId: string): Promise<OrgMember[]>;
  listCategories(orgId: string): Promise<Category[]>;
  createCategories(
    orgId: string,
    categories: { name: string; icon: string | null; isDefault: boolean }[],
  ): Promise<Category[]>;
}

export interface ExpenseRepository {
  findById(orgId: string, id: string): Promise<Expense | null>;
  list(orgId: string, query: ExpenseQuery): Promise<Page<Expense>>;
  create(input: CreateExpenseInput): Promise<Expense>;
  update(orgId: string, id: string, patch: UpdateExpenseInput): Promise<Expense>;
  softDelete(orgId: string, id: string): Promise<void>;
  /** Spend per category over a date window, for GET /api/budgets/status. */
  sumByCategory(orgId: string, from: string, to: string): Promise<CategorySpendRow[]>;
  recordApproval(input: {
    expenseId: string;
    approverId: string;
    status: Extract<ExpenseStatus, 'approved' | 'rejected'>;
    comment: string | null;
  }): Promise<Approval>;
}

export interface BudgetRepository {
  list(orgId: string): Promise<Budget[]>;
  create(input: {
    orgId: string;
    categoryId: string | null;
    amount: number;
    period: 'monthly';
    rollover: boolean;
  }): Promise<Budget>;
}

export interface ToolCallLogRepository {
  append(input: AppendToolCallInput): Promise<ToolCallLogEntry>;
  list(
    orgId: string,
    options: { actor?: 'human' | 'agent'; limit: number; offset: number },
  ): Promise<Page<ToolCallLogEntry>>;
}

export interface RefreshTokenRepository {
  create(input: {
    jti: string;
    userId: string;
    orgId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent: string | null;
  }): Promise<RefreshTokenRecord>;
  findByJti(jti: string): Promise<RefreshTokenRecord | null>;
  /** Rotation: mark the presented token spent and point it at its successor. */
  revoke(jti: string, replacedBy: string | null): Promise<void>;
  /** Reuse-detection panic button, and "revoke all devices" in settings. */
  revokeAllForUser(userId: string): Promise<void>;
}

export interface ListAuditQuery {
  /** Narrow to one kind of thing, e.g. `expense`. */
  entity?: string;
  limit: number;
  offset: number;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
  /** Newest first, for GET /api/audit-log. Backed by `audit_log_org_created_idx`. */
  list(orgId: string, query: ListAuditQuery): Promise<Page<AuditLogEntry>>;
}

// Injection tokens

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const ORG_REPOSITORY = Symbol('ORG_REPOSITORY');
export const EXPENSE_REPOSITORY = Symbol('EXPENSE_REPOSITORY');
export const BUDGET_REPOSITORY = Symbol('BUDGET_REPOSITORY');
export const TOOL_CALL_LOG_REPOSITORY = Symbol('TOOL_CALL_LOG_REPOSITORY');
export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
