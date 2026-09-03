import { Inject, Injectable } from '@nestjs/common';
import type { AnalyticsSummary, CategorySpend } from '@actuo/shared';
import { EnvService } from '../config/env.service.js';
import {
  EXPENSE_REPOSITORY,
  ORG_REPOSITORY,
  type ExpenseRepository,
  type OrgRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AnalyticsQueryDto } from './dto/analytics.dto.js';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly env: EnvService,
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
  ) {}

  /**
   * Returns a month-over-month analytics summary for the dashboard hero tile
   * and the `get_analytics_summary` WebMCP tool.
   *
   * The window defaults to the current calendar month. `previousMonthSpend`
   * always refers to the calendar month before `from`, not "the previous N days".
   */
  async summary(user: AuthenticatedUser, query: AnalyticsQueryDto): Promise<AnalyticsSummary> {
    const { from, to } = resolveWindow(query);
    const prev = resolvePreviousWindow(from);

    const [spendRows, prevSpendRows, categories, org] = await Promise.all([
      this.expenses.sumByCategory(user.orgId, from, to),
      this.expenses.sumByCategory(user.orgId, prev.from, prev.to),
      this.orgs.listCategories(user.orgId),
      this.orgs.findOrg(user.orgId),
    ]);

    const currency = org?.baseCurrency ?? this.env.baseCurrency;
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

    const monthSpend = round2(spendRows.reduce((sum, r) => sum + r.total, 0));
    const previousMonthSpend = round2(prevSpendRows.reduce((sum, r) => sum + r.total, 0));
    const unconvertedCount = spendRows.reduce((sum, r) => sum + r.unconverted, 0);

    const monthOverMonthDelta =
      previousMonthSpend > 0 ? round2((monthSpend / previousMonthSpend - 1) * 100) : null;

    const byCategory: CategorySpend[] = spendRows
      .map((row) => ({
        categoryId: row.categoryId,
        categoryName:
          row.categoryId === null
            ? 'Uncategorised'
            : (categoryNames.get(row.categoryId) ?? 'Unknown'),
        spent: round2(row.total),
        share: monthSpend > 0 ? round2(row.total / monthSpend) : 0,
      }))
      .sort((a, b) => b.spent - a.spent);

    return {
      month: from.slice(0, 7),
      currency,
      monthSpend,
      previousMonthSpend,
      monthOverMonthDelta,
      byCategory,
      unconvertedCount,
      // sumByCategory already excludes drafts, so this is always 0 from that query.
      // A separate query would be needed to count them; for now we report 0.
      draftCount: 0,
    };
  }
}

/** Defaults to the first and last day of the current month, in UTC. */
function resolveWindow(query: AnalyticsQueryDto): { from: string; to: string } {
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

/** Returns the window for the calendar month before `from`. */
function resolvePreviousWindow(from: string): { from: string; to: string } {
  const date = new Date(from + 'T00:00:00Z');
  const prevStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  const prevEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
  return { from: isoDate(prevStart.toISOString()), to: isoDate(prevEnd.toISOString()) };
}

/** `expense_date` is a DATE column; compare against YYYY-MM-DD, not a timestamp. */
function isoDate(value: string): string {
  return value.slice(0, 10);
}

/** Money and ratios both round to 2dp; floats otherwise leak 0.30000000000000004. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
