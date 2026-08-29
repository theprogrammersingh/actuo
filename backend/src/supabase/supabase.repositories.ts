import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Approval,
  Budget,
  Category,
  Expense,
  ExpenseStatus,
  Membership,
  Organization,
  AuditLogEntry,
  Page,
  Role,
  ToolCallLogEntry,
} from '@actuo/shared';
import { SupabaseService } from './supabase.service.js';
import * as map from './mappers.js';
import type {
  AppendToolCallInput,
  AuditEntry,
  AuditLogRepository,
  BudgetRepository,
  CategorySpendRow,
  CreateExpenseInput,
  ExpenseQuery,
  ExpenseRepository,
  ListAuditQuery,
  OrgMember,
  OrgRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  ToolCallLogRepository,
  UpdateExpenseInput,
  UserRecord,
  UserRepository,
} from './repositories.js';

/** PostgREST codes we translate rather than let bubble as a 500. */
const PG_UNIQUE_VIOLATION = '23505';
/** "JSON object requested, multiple (or no) rows returned" — from .single(). */
const PGRST_NO_ROWS = 'PGRST116';

/**
 * Every repository method funnels errors through here so that a failed query
 * surfaces as an HTTP status that means something, with the Postgres message
 * attached, instead of an opaque 500.
 */
function fail(error: PostgrestError, what: string): never {
  if (error.code === PG_UNIQUE_VIOLATION) {
    throw new ConflictException(`${what} already exists.`);
  }
  throw new InternalServerErrorException(`${what} failed: ${error.message}`);
}

/** `.single()` on a miss is a 404, not an error — unwrap that case first. */
function optional<T>(
  data: unknown,
  error: PostgrestError | null,
  mapper: (row: any) => T,
  what: string,
): T | null {
  if (error) {
    if (error.code === PGRST_NO_ROWS) return null;
    fail(error, what);
  }
  return data ? mapper(data) : null;
}

@Injectable()
export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select('*')
      // The unique index is on lower(email); match it so a differently-cased
      // signup cannot create a second account for the same person.
      .ilike('email', email.trim())
      .maybeSingle();
    return optional(data, error, map.toUser, 'User lookup');
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return optional(data, error, map.toUser, 'User lookup');
  }

  async create(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .insert({
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        password_hash: input.passwordHash,
      })
      .select('*')
      .single();
    if (error) fail(error, 'An account with that email');
    return map.toUser(data);
  }
}

@Injectable()
export class SupabaseOrgRepository implements OrgRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async createOrg(input: { name: string; baseCurrency: string }): Promise<Organization> {
    const { data, error } = await this.supabase
      .getClient()
      .from('organizations')
      .insert({ name: input.name.trim(), base_currency: input.baseCurrency })
      .select('*')
      .single();
    if (error) fail(error, 'Organization creation');
    return map.toOrganization(data);
  }

  async findOrg(orgId: string): Promise<Organization | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();
    return optional(data, error, map.toOrganization, 'Organization lookup');
  }

  async createMembership(input: {
    userId: string;
    orgId: string;
    role: Role;
  }): Promise<Membership> {
    const { data, error } = await this.supabase
      .getClient()
      .from('memberships')
      .insert({ user_id: input.userId, org_id: input.orgId, role: input.role })
      .select('*')
      .single();
    if (error) fail(error, 'Membership');
    return map.toMembership(data);
  }

  async findMembership(userId: string, orgId: string): Promise<Membership | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();
    return optional(data, error, map.toMembership, 'Membership lookup');
  }

  async findFirstMembership(userId: string): Promise<Membership | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('memberships')
      .select('*')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return optional(data, error, map.toMembership, 'Membership lookup');
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('memberships')
      .select('user_id, role, joined_at, users ( email, name )')
      .eq('org_id', orgId)
      .order('joined_at', { ascending: true });
    if (error) fail(error, 'Member listing');
    return (data ?? []).map(map.toOrgMember);
  }

  async listCategories(orgId: string): Promise<Category[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('categories')
      .select('*')
      .eq('org_id', orgId)
      .order('name', { ascending: true });
    if (error) fail(error, 'Category listing');
    return (data ?? []).map(map.toCategory);
  }

  async createCategories(
    orgId: string,
    categories: { name: string; icon: string | null; isDefault: boolean }[],
  ): Promise<Category[]> {
    if (categories.length === 0) return [];
    const { data, error } = await this.supabase
      .getClient()
      .from('categories')
      .insert(
        categories.map((c) => ({
          org_id: orgId,
          name: c.name,
          icon: c.icon,
          is_default: c.isDefault,
        })),
      )
      .select('*');
    if (error) fail(error, 'Category creation');
    return (data ?? []).map(map.toCategory);
  }
}

@Injectable()
export class SupabaseExpenseRepository implements ExpenseRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findById(orgId: string, id: string): Promise<Expense | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('expenses')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      // Soft-deleted rows are invisible to every read path.
      .is('deleted_at', null)
      .maybeSingle();
    return optional(data, error, map.toExpense, 'Expense lookup');
  }

  async list(orgId: string, query: ExpenseQuery): Promise<Page<Expense>> {
    let q = this.supabase
      .getClient()
      .from('expenses')
      // 'exact' so `total` is a real count, which is what pagination needs.
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null);

    if (query.userId) q = q.eq('user_id', query.userId);
    if (query.categoryId) q = q.eq('category_id', query.categoryId);
    if (query.status) q = q.eq('status', query.status);
    if (query.from) q = q.gte('expense_date', query.from);
    if (query.to) q = q.lte('expense_date', query.to);
    if (query.query) {
      // Free text hits merchant OR note. Commas and parens are PostgREST's
      // own separators inside .or(), so a raw user string would corrupt the
      // filter; escape them out before interpolating.
      const term = query.query.replace(/[,()\\]/g, ' ').trim();
      if (term) q = q.or(`merchant.ilike.%${term}%,note.ilike.%${term}%`);
    }

    const { data, error, count } = await q
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) fail(error, 'Expense listing');
    return {
      items: (data ?? []).map(map.toExpense),
      total: count ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async create(input: CreateExpenseInput): Promise<Expense> {
    const { data, error } = await this.supabase
      .getClient()
      .from('expenses')
      .insert({
        org_id: input.orgId,
        user_id: input.userId,
        category_id: input.categoryId,
        amount: input.amount,
        currency: input.currency,
        converted_amount: input.convertedAmount,
        base_currency: input.baseCurrency,
        merchant: input.merchant,
        note: input.note,
        expense_date: input.expenseDate,
        status: input.status,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Expense creation');
    return map.toExpense(data);
  }

  async update(orgId: string, id: string, patch: UpdateExpenseInput): Promise<Expense> {
    const row: Record<string, unknown> = {};
    if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
    if (patch.amount !== undefined) row.amount = patch.amount;
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (patch.convertedAmount !== undefined) row.converted_amount = patch.convertedAmount;
    if (patch.merchant !== undefined) row.merchant = patch.merchant;
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.expenseDate !== undefined) row.expense_date = patch.expenseDate;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.receiptUrl !== undefined) row.receipt_url = patch.receiptUrl;

    const { data, error } = await this.supabase
      .getClient()
      .from('expenses')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();
    if (error) {
      if (error.code === PGRST_NO_ROWS) throw new NotFoundException('Expense not found.');
      fail(error, 'Expense update');
    }
    return map.toExpense(data);
  }

  async softDelete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .getClient()
      .from('expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('id', id)
      .is('deleted_at', null);
    if (error) fail(error, 'Expense delete');
  }

  async sumByCategory(orgId: string, from: string, to: string): Promise<CategorySpendRow[]> {
    // Aggregated in the service rather than in SQL: PostgREST needs an RPC for
    // GROUP BY, and a month of one org's expenses is a small result set. If
    // this ever gets slow, replace it with a `sum_by_category` Postgres
    // function — the repository interface would not change.
    const { data, error } = await this.supabase
      .getClient()
      .from('expenses')
      .select('category_id, converted_amount')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      // Rejected spend is not spend. Drafts are not committed either.
      .in('status', ['submitted', 'approved', 'reimbursed'])
      .gte('expense_date', from)
      .lte('expense_date', to);
    if (error) fail(error, 'Budget rollup');

    /*
     * Only `converted_amount` counts, and rows without one are counted, not
     * summed.
     *
     * This used to fall back to the raw `amount`, on the reasoning that a
     * slightly wrong number beat a budget bar reading zero. That was wrong:
     * `converted_amount` is written only when the expense is already in the
     * base currency (PRD §6.5 — there is no FX pass), so the fallback added
     * dollars and euros to rupees at 1:1. A $200 dinner landed in the budget
     * as ₹200. The caller reports the skipped count, so the gap is visible
     * rather than baked into a confident wrong total.
     *
     * When a real FX pass starts filling `converted_amount`, those rows
     * re-enter the sum here with no change to this code.
     */
    const totals = new Map<string | null, { total: number; unconverted: number }>();
    for (const row of data ?? []) {
      const key = (row as any).category_id ?? null;
      const bucket = totals.get(key) ?? { total: 0, unconverted: 0 };
      const converted = (row as any).converted_amount;
      if (converted === null || converted === undefined) bucket.unconverted += 1;
      else bucket.total += Number(converted) || 0;
      totals.set(key, bucket);
    }
    return [...totals].map(([categoryId, sums]) => ({ categoryId, ...sums }));
  }

  async recordApproval(input: {
    expenseId: string;
    approverId: string;
    status: Extract<ExpenseStatus, 'approved' | 'rejected'>;
    comment: string | null;
  }): Promise<Approval> {
    const { data, error } = await this.supabase
      .getClient()
      .from('approvals')
      .insert({
        expense_id: input.expenseId,
        approver_id: input.approverId,
        status: input.status,
        comment: input.comment,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Approval record');
    return map.toApproval(data);
  }
}

@Injectable()
export class SupabaseBudgetRepository implements BudgetRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<Budget[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('budgets')
      .select('*')
      .eq('org_id', orgId);
    if (error) fail(error, 'Budget listing');
    return (data ?? []).map(map.toBudget);
  }

  async create(input: {
    orgId: string;
    categoryId: string | null;
    amount: number;
    period: 'monthly';
    rollover: boolean;
  }): Promise<Budget> {
    const { data, error } = await this.supabase
      .getClient()
      .from('budgets')
      .insert({
        org_id: input.orgId,
        category_id: input.categoryId,
        amount: input.amount,
        period: input.period,
        rollover: input.rollover,
      })
      .select('*')
      .single();
    if (error) fail(error, 'A budget for that category');
    return map.toBudget(data);
  }
}

@Injectable()
export class SupabaseToolCallLogRepository implements ToolCallLogRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async append(input: AppendToolCallInput): Promise<ToolCallLogEntry> {
    const { data, error } = await this.supabase
      .getClient()
      .from('tool_call_log')
      .insert({
        org_id: input.orgId,
        actor_id: input.actorId,
        actor: input.actor,
        tool_name: input.toolName,
        input: input.input ?? null,
        output: input.output ?? null,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Tool call log write');
    return map.toToolCallLogEntry(data);
  }

  async list(
    orgId: string,
    options: { actor?: 'human' | 'agent'; limit: number; offset: number },
  ): Promise<Page<ToolCallLogEntry>> {
    let q = this.supabase
      .getClient()
      .from('tool_call_log')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);
    if (options.actor) q = q.eq('actor', options.actor);

    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(options.offset, options.offset + options.limit - 1);
    if (error) fail(error, 'Tool call log read');
    return {
      items: (data ?? []).map(map.toToolCallLogEntry),
      total: count ?? 0,
      limit: options.limit,
      offset: options.offset,
    };
  }
}

@Injectable()
export class SupabaseRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async create(input: {
    jti: string;
    userId: string;
    orgId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent: string | null;
  }): Promise<RefreshTokenRecord> {
    const { data, error } = await this.supabase
      .getClient()
      .from('refresh_tokens')
      .insert({
        jti: input.jti,
        user_id: input.userId,
        org_id: input.orgId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
        user_agent: input.userAgent,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Refresh token issue');
    return map.toRefreshToken(data);
  }

  async findByJti(jti: string): Promise<RefreshTokenRecord | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('refresh_tokens')
      .select('*')
      .eq('jti', jti)
      .maybeSingle();
    return optional(data, error, map.toRefreshToken, 'Refresh token lookup');
  }

  async revoke(jti: string, replacedBy: string | null): Promise<void> {
    const { error } = await this.supabase
      .getClient()
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString(), replaced_by: replacedBy })
      .eq('jti', jti);
    if (error) fail(error, 'Refresh token revoke');
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const { error } = await this.supabase
      .getClient()
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) fail(error, 'Session revoke');
  }
}

@Injectable()
export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async append(entry: AuditEntry): Promise<void> {
    const { error } = await this.supabase
      .getClient()
      .from('audit_log')
      .insert({
        org_id: entry.orgId,
        actor_id: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId,
        metadata: entry.metadata ?? {},
      });
    if (error) fail(error, 'Audit log write');
  }

  async list(orgId: string, query: ListAuditQuery): Promise<Page<AuditLogEntry>> {
    let q = this.supabase
      .getClient()
      .from('audit_log')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);
    if (query.entity) q = q.eq('entity', query.entity);

    // Matches `audit_log_org_created_idx` (org_id, created_at desc).
    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);
    if (error) fail(error, 'Audit log read');
    return {
      items: (data ?? []).map(map.toAuditLogEntry),
      total: count ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
