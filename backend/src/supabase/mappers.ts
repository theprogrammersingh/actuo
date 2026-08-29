/**
 * snake_case Postgres rows -> camelCase domain types from `@actuo/shared`.
 *
 * Kept in one file on purpose: this is the only place the database's column
 * naming is allowed to be visible. Everything above the repository layer sees
 * domain types only.
 *
 * `numeric` columns are coerced with Number(). PostgREST emits them as JSON
 * numbers today, but the driver has historically returned strings for wide
 * numerics, and a silently stringy `amount` would break every sum downstream
 * by concatenating instead of adding.
 */

import type {
  Approval,
  Budget,
  Category,
  Expense,
  Membership,
  Organization,
  AuditLogEntry,
  ToolCallLogEntry,
} from '@actuo/shared';
import type { OrgMember, RefreshTokenRecord, UserRecord } from './repositories.js';

type Row = Record<string, any>;

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const toUser = (r: Row): UserRecord => ({
  id: r.id,
  email: r.email,
  name: r.name,
  passwordHash: r.password_hash,
  createdAt: r.created_at,
});

export const toOrganization = (r: Row): Organization => ({
  id: r.id,
  name: r.name,
  baseCurrency: r.base_currency,
  createdAt: r.created_at,
});

export const toMembership = (r: Row): Membership => ({
  id: r.id,
  userId: r.user_id,
  orgId: r.org_id,
  role: r.role,
  joinedAt: r.joined_at,
});

export const toCategory = (r: Row): Category => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  icon: r.icon ?? null,
  isDefault: Boolean(r.is_default),
});

export const toExpense = (r: Row): Expense => ({
  id: r.id,
  orgId: r.org_id,
  userId: r.user_id,
  categoryId: r.category_id ?? null,
  amount: num(r.amount),
  currency: r.currency,
  convertedAmount: numOrNull(r.converted_amount),
  baseCurrency: r.base_currency,
  merchant: r.merchant ?? null,
  note: r.note ?? null,
  status: r.status,
  receiptUrl: r.receipt_url ?? null,
  expenseDate: r.expense_date,
  createdAt: r.created_at,
  deletedAt: r.deleted_at ?? null,
});

export const toBudget = (r: Row): Budget => ({
  id: r.id,
  orgId: r.org_id,
  categoryId: r.category_id ?? null,
  amount: num(r.amount),
  period: r.period,
  rollover: Boolean(r.rollover),
});

export const toApproval = (r: Row): Approval => ({
  id: r.id,
  expenseId: r.expense_id,
  approverId: r.approver_id,
  status: r.status,
  comment: r.comment ?? null,
  decidedAt: r.decided_at,
});

export const toToolCallLogEntry = (r: Row): ToolCallLogEntry => ({
  id: r.id,
  orgId: r.org_id,
  actor: r.actor,
  toolName: r.tool_name,
  input: r.input ?? null,
  output: r.output ?? null,
  createdAt: r.created_at,
});

export const toAuditLogEntry = (r: Row): AuditLogEntry => ({
  id: r.id,
  orgId: r.org_id,
  actorId: r.actor_id ?? null,
  action: r.action,
  entity: r.entity,
  entityId: r.entity_id ?? null,
  // The column is `not null default '{}'`, but a hand-written row could still
  // hold null; the viewer renders this and must not have to guard it.
  metadata: r.metadata ?? {},
  createdAt: r.created_at,
});

export const toRefreshToken = (r: Row): RefreshTokenRecord => ({
  id: r.id,
  jti: r.jti,
  userId: r.user_id,
  orgId: r.org_id,
  tokenHash: r.token_hash,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at ?? null,
  createdAt: r.created_at,
});

/**
 * `memberships` joined to `users`. PostgREST returns the embedded relation as
 * either an object or a one-element array depending on how it infers the
 * cardinality, so normalise both shapes rather than trusting one.
 */
export const toOrgMember = (r: Row): OrgMember => {
  const user = Array.isArray(r.users) ? r.users[0] : r.users;
  return {
    userId: r.user_id,
    email: user?.email ?? '',
    name: user?.name ?? '',
    role: r.role,
    joinedAt: r.joined_at,
  };
};
