import { Inject, Injectable } from '@nestjs/common';
import type { Budget, BudgetStatus } from '@actuo/shared';
import { EnvService } from '../config/env.service.js';
import {
  BUDGET_REPOSITORY,
  EXPENSE_REPOSITORY,
  ORG_REPOSITORY,
  type BudgetRepository,
  type ExpenseRepository,
  type OrgRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { BudgetStatusQueryDto, CreateBudgetDto } from './dto/budget.dto.js';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly env: EnvService,
    @Inject(BUDGET_REPOSITORY) private readonly budgets: BudgetRepository,
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
  ) {}

  list(user: AuthenticatedUser): Promise<Budget[]> {
    return this.budgets.list(user.orgId);
  }

  create(user: AuthenticatedUser, dto: CreateBudgetDto): Promise<Budget> {
    return this.budgets.create({
      orgId: user.orgId,
      categoryId: dto.categoryId ?? null,
      amount: dto.amount,
      period: dto.period ?? 'monthly',
      rollover: dto.rollover ?? false,
    });
  }

  /**
   * `GET /api/budgets/status` — the shape behind the dashboard's progress bars
   * and the `get_budget_status` WebMCP tool. Returns `BudgetStatus[]` exactly
   * as declared in `@actuo/shared`.
   *
   * Three details worth knowing:
   *
   *  - The window defaults to the current calendar month, because budgets are
   *    monthly. Callers can override it for "how did last month go".
   *  - Categories with a budget always appear, even at zero spend — a budget
   *    you have not touched is information, and a bar that vanishes when unused
   *    reads as a bug.
   *  - Categories with spend but *no* budget also appear, with `budgeted: 0`
   *    and `utilization: 0`. That is the "unbudgeted spend" row; hiding it
   *    would make the totals silently disagree with the expense list.
   */
  async status(user: AuthenticatedUser, query: BudgetStatusQueryDto): Promise<BudgetStatus[]> {
    const { from, to } = resolveWindow(query);

    const [budgets, categories, spendRows, org] = await Promise.all([
      this.budgets.list(user.orgId),
      this.orgs.listCategories(user.orgId),
      this.expenses.sumByCategory(user.orgId, from, to),
      this.orgs.findOrg(user.orgId),
    ]);

    const currency = org?.baseCurrency ?? this.env.baseCurrency;
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    const spendByCategory = new Map(spendRows.map((row) => [row.categoryId, row.total]));

    // Union of "has a budget" and "has spend", so neither side can hide a row.
    const keys = new Set<string | null>([
      ...budgets.map((b) => b.categoryId),
      ...spendByCategory.keys(),
    ]);

    const rows: BudgetStatus[] = [];
    for (const categoryId of keys) {
      const budget = budgets.find((b) => b.categoryId === categoryId);
      const budgeted = budget?.amount ?? 0;
      const spent = round2(spendByCategory.get(categoryId) ?? 0);

      rows.push({
        categoryId,
        categoryName:
          categoryId === null
            ? 'All categories'
            : (categoryNames.get(categoryId) ?? 'Uncategorised'),
        budgeted,
        spent,
        // Can go negative — that is the over-budget signal the UI colours red.
        remaining: round2(budgeted - spent),
        // Guard the divide: an unbudgeted category would otherwise produce
        // Infinity (or NaN at zero spend) and break the progress bar's width.
        utilization: budgeted > 0 ? round2(spent / budgeted) : 0,
        currency,
      });
    }

    // Most-utilised first: the rows a user needs to act on lead the list. The
    // org-wide row (categoryId null) is pushed last so it reads as a summary.
    return rows.sort((a, b) => {
      if (a.categoryId === null) return 1;
      if (b.categoryId === null) return -1;
      return b.utilization - a.utilization || b.spent - a.spent;
    });
  }
}

/** Defaults to the first and last day of the current month, in UTC. */
function resolveWindow(query: BudgetStatusQueryDto): { from: string; to: string } {
  if (query.from && query.to) return { from: isoDate(query.from), to: isoDate(query.to) };

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Day 0 of next month is the last day of this one, leap years included.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: query.from ? isoDate(query.from) : isoDate(start.toISOString()),
    to: query.to ? isoDate(query.to) : isoDate(end.toISOString()),
  };
}

/** `expense_date` is a DATE column; compare against YYYY-MM-DD, not a timestamp. */
function isoDate(value: string): string {
  return value.slice(0, 10);
}

/** Money and ratios both round to 2dp; floats otherwise leak 0.30000000000000004. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
