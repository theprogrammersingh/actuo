import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EXPENSE_PAGE_DEFAULT, EXPENSE_PAGE_MAX } from '@actuo/shared';
import type { Expense, ExpenseStatus, Page, Role } from '@actuo/shared';
import { EnvService } from '../config/env.service.js';
import {
  AUDIT_LOG_REPOSITORY,
  EXPENSE_REPOSITORY,
  ORG_REPOSITORY,
  type AuditLogRepository,
  type ExpenseQuery,
  type ExpenseRepository,
  type OrgRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { CreateExpenseDto, SearchExpensesQueryDto, UpdateExpenseDto } from './dto/expense.dto.js';
import {
  OWNER_ONLY_ACTIONS,
  assertTransition,
  roleMayPerform,
  targetStatusFor,
  type TransitionAction,
} from './expense-state-machine.js';


/** Roles that can see and act on the whole org's expenses. */
const APPROVER_ROLES: readonly Role[] = ['owner', 'admin'];

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly env: EnvService,
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /**
   * Members see only the expenses they submitted; owners and admins see the
   * whole org.
   *
   * This is enforced by *adding* a `user_id` filter, not by filtering results
   * after the fact — so `total` in the page is right too, and a member paging
   * through cannot infer how many rows they were not shown.
   */
  async list(user: AuthenticatedUser, dto: SearchExpensesQueryDto): Promise<Page<Expense>> {
    return this.expenses.list(user.orgId, this.toQuery(user, dto));
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Expense> {
    const expense = await this.requireExpense(user, id);
    this.assertCanView(user, expense);
    return expense;
  }

  async create(user: AuthenticatedUser, dto: CreateExpenseDto): Promise<Expense> {
    const baseCurrency = await this.baseCurrencyFor(user.orgId);

    const expense = await this.expenses.create({
      orgId: user.orgId,
      // The submitter is always the authenticated caller. Not a body field —
      // otherwise any member could file expenses in someone else's name.
      userId: user.userId,
      categoryId: dto.categoryId ?? null,
      amount: dto.amount,
      currency: dto.currency,
      // PRD §6.5: converted_amount is filled by the FX pass. When the expense
      // is already in the base currency there is nothing to convert, so it is
      // set immediately; otherwise it stays null until rates are wired up.
      convertedAmount: dto.currency === baseCurrency ? dto.amount : null,
      baseCurrency,
      merchant: dto.merchant ?? null,
      note: dto.note ?? null,
      expenseDate: dto.expenseDate,
      // Everything starts as a draft. Submitting is a separate, explicit act
      // so the state machine has a real starting point (PRD §6.4).
      status: 'draft',
    });

    await this.safeAudit(user, 'expense.created', expense.id, {
      amount: expense.amount,
      currency: expense.currency,
    });
    return expense;
  }

  /**
   * Field edits and status changes both arrive here.
   *
   * A status in the patch is not applied directly — it is routed through the
   * same `transition()` path the dedicated endpoints use, so PATCH cannot be
   * used to walk around the state machine or the role table.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.requireExpense(user, id);
    const { status, ...fields } = dto;

    const hasFieldEdits = Object.values(fields).some((value) => value !== undefined);
    let current = expense;

    if (hasFieldEdits) {
      this.assertCanEdit(user, expense);
      const baseCurrency = expense.baseCurrency;
      const nextCurrency = fields.currency ?? expense.currency;
      const nextAmount = fields.amount ?? expense.amount;

      current = await this.expenses.update(user.orgId, id, {
        ...fields,
        // Keep converted_amount consistent with whatever amount/currency now
        // are: a stale conversion is worse than an honest null.
        ...(fields.amount !== undefined || fields.currency !== undefined
          ? { convertedAmount: nextCurrency === baseCurrency ? nextAmount : null }
          : {}),
      });
      await this.safeAudit(user, 'expense.updated', id, { fields: Object.keys(fields) });
    }

    if (status && status !== current.status) {
      current = await this.applyTransition(user, current, status, null);
    }

    return current;
  }

  /** Soft delete (PRD §6.2) — the row survives so approvals and audit hold. */
  async remove(user: AuthenticatedUser, id: string): Promise<{ id: string; deleted: true }> {
    const expense = await this.requireExpense(user, id);
    this.assertCanEdit(user, expense);
    await this.expenses.softDelete(user.orgId, id);
    await this.safeAudit(user, 'expense.deleted', id, { soft: true });
    return { id, deleted: true };
  }

  /**
   * The single entry point for submit / approve / reject / reimburse.
   *
   * Three checks, in this order, because each one's error is only meaningful
   * if the previous passed: does the row exist in my org, may my role do this
   * at all, and is the move legal from the current status.
   */
  async transition(
    user: AuthenticatedUser,
    id: string,
    action: TransitionAction,
    comment: string | null,
  ): Promise<Expense> {
    const expense = await this.requireExpense(user, id);
    return this.applyTransition(user, expense, targetStatusFor(action), comment, action);
  }

  private async applyTransition(
    user: AuthenticatedUser,
    expense: Expense,
    to: ExpenseStatus,
    comment: string | null,
    knownAction?: TransitionAction,
  ): Promise<Expense> {
    const action = knownAction ?? actionForStatus(to);
    const role = user.role;
    if (!role) {
      // Only reachable if a route forgot @Roles(); RolesGuard is what fills
      // this in. Fail closed rather than assuming the weakest role.
      throw new ForbiddenException('Role could not be resolved for this request.');
    }

    if (!roleMayPerform(role, action)) {
      throw new ForbiddenException(
        `Your role (${role}) cannot move an expense to ${to}.`,
      );
    }

    // Submit and rework are the actions a member performs, and only on their
    // own expense. Approvers act on anyone's.
    if (
      OWNER_ONLY_ACTIONS.includes(action) &&
      !this.isApprover(role) &&
      expense.userId !== user.userId
    ) {
      throw new ForbiddenException(`You can only ${action} your own expenses.`);
    }

    // Self-approval is a segregation-of-duties hole: an admin could file and
    // approve their own reimbursement with nobody else involved.
    if ((action === 'approve' || action === 'reject') && expense.userId === user.userId) {
      throw new ForbiddenException(
        'You cannot approve or reject your own expense. Ask another approver.',
      );
    }

    // 409 if illegal — see IllegalTransitionException for why not 400.
    assertTransition(expense.status, to);

    const updated = await this.expenses.update(user.orgId, expense.id, { status: to });

    if (to === 'approved' || to === 'rejected') {
      // The decision record (PRD §6.4). Recorded after the status write so a
      // failed update never leaves a decision for a transition that did not
      // happen.
      await this.expenses.recordApproval({
        expenseId: expense.id,
        approverId: user.userId,
        status: to,
        comment,
      });
    }

    await this.safeAudit(user, `expense.${to}`, expense.id, {
      from: expense.status,
      to,
      ...(comment ? { comment } : {}),
    });
    return updated;
  }

  // -------------------------------------------------------------------------

  private toQuery(user: AuthenticatedUser, dto: SearchExpensesQueryDto): ExpenseQuery {
    return {
      query: dto.query,
      categoryId: dto.categoryId,
      status: dto.status,
      userId: this.isApprover(user.role) ? undefined : user.userId,
      from: dto.from,
      to: dto.to,
      limit: Math.min(dto.limit ?? EXPENSE_PAGE_DEFAULT, EXPENSE_PAGE_MAX),
      offset: dto.offset ?? 0,
    };
  }

  private async requireExpense(user: AuthenticatedUser, id: string): Promise<Expense> {
    const expense = await this.expenses.findById(user.orgId, id);
    // Scoped by org in the query, so an id from another tenant is simply not
    // found — no existence oracle across orgs.
    if (!expense) throw new NotFoundException('Expense not found.');
    return expense;
  }

  private isApprover(role: Role | undefined): boolean {
    return role !== undefined && APPROVER_ROLES.includes(role);
  }

  private assertCanView(user: AuthenticatedUser, expense: Expense): void {
    if (this.isApprover(user.role) || expense.userId === user.userId) return;
    // 404, not 403: a member should not be able to probe which expense ids
    // exist in their org.
    throw new NotFoundException('Expense not found.');
  }

  /**
   * Who may change an expense's *fields*.
   *
   * The status gate is the important half: once an expense is submitted it is
   * evidence in an approval decision, and letting the submitter edit the
   * amount afterwards would make approval meaningless. Rework goes
   * rejected -> draft first.
   */
  private assertCanEdit(user: AuthenticatedUser, expense: Expense): void {
    if (expense.userId !== user.userId && !this.isApprover(user.role)) {
      throw new NotFoundException('Expense not found.');
    }
    if (expense.status !== 'draft' && expense.status !== 'rejected') {
      throw new ForbiddenException(
        `An expense that is ${expense.status} can no longer be edited. ` +
          'Only draft and rejected expenses are editable.',
      );
    }
  }

  private async baseCurrencyFor(orgId: string): Promise<string> {
    try {
      const org = await this.orgs.findOrg(orgId);
      return org?.baseCurrency ?? this.env.baseCurrency;
    } catch (error) {
      this.logger.warn(`Falling back to the default base currency: ${(error as Error).message}`);
      return this.env.baseCurrency;
    }
  }

  /** Audit writes never fail the request they describe. */
  private async safeAudit(
    user: AuthenticatedUser,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.append({
        orgId: user.orgId,
        actorId: user.userId,
        action,
        entity: 'expense',
        entityId,
        metadata,
      });
    } catch (error) {
      this.logger.warn(`Audit write failed for ${action}: ${(error as Error).message}`);
    }
  }
}

/** Reverse of TRANSITION_ACTIONS, for status changes arriving via PATCH. */
function actionForStatus(status: ExpenseStatus): TransitionAction {
  switch (status) {
    case 'submitted':
      return 'submit';
    case 'approved':
      return 'approve';
    case 'rejected':
      return 'reject';
    case 'reimbursed':
      return 'reimburse';
    case 'draft':
      return 'rework';
  }
}
