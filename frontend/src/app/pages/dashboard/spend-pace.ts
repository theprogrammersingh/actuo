/**
 * Dashboard arithmetic.
 *
 * There is deliberately no `/api/analytics/*` yet, so every figure on the
 * dashboard is derived here from the expense rows the page already fetched.
 * Everything in this file is a pure function over plain data — no injector, no
 * `Date.now()`, no signals — so the numbers can be unit-tested directly rather
 * than through a rendered component.
 */

import type { Expense } from '@actuo/shared';
import { expenseAmount, isSpend } from '../../core/expense/amount.js';

/** ---------------------------------------------------------------- amounts */

/*
 * `expenseAmount` and `isSpend` live in core/expense because dashboard,
 * expenses and budgets all total money and must agree on which amount field
 * wins and which rows count. Two copies of those rules would let the screens
 * quietly contradict each other about how much was spent.
 *
 * Re-exported here so this module stays the single import site for dashboard
 * arithmetic.
 */
export { expenseAmount, isSpend };

/** ------------------------------------------------------------------ dates */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-08-27` → `2026-08`. String slicing, never `new Date`, to stay timezone-free. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The window the dashboard fetches and reports on, derived from the user's
 * local calendar date.
 *
 * It reaches back to the first of *last* month because the spend-pace card
 * falls back to comparing against last month's total when the org has not set
 * any budgets.
 */
export interface SpendWindow {
  /** Inclusive lower bound for the API query — first day of last month. */
  from: string;
  /** Inclusive upper bound — today. */
  to: string;
  /** `YYYY-MM` of the month being reported. */
  month: string;
  previousMonth: string;
  /** 1-based day of the month, i.e. how much of the month has elapsed. */
  dayOfMonth: number;
  daysInMonth: number;
}

export function spendWindow(today: Date): SpendWindow {
  const year = today.getFullYear();
  const monthIndex = today.getMonth();
  const dayOfMonth = today.getDate();

  const previous = new Date(year, monthIndex - 1, 1);
  const previousMonth = `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}`;

  return {
    from: `${previousMonth}-01`,
    to: `${year}-${pad(monthIndex + 1)}-${pad(dayOfMonth)}`,
    month: `${year}-${pad(monthIndex + 1)}`,
    previousMonth,
    dayOfMonth,
    // Day 0 of the next month is the last day of this one.
    daysInMonth: new Date(year, monthIndex + 1, 0).getDate(),
  };
}

/** --------------------------------------------------------------- rollups */

/** Total spend for one `YYYY-MM`, counting only rows that qualify as spend. */
export function totalForMonth(expenses: readonly Expense[], month: string): number {
  return expenses.reduce(
    (sum, expense) =>
      isSpend(expense) && monthKey(expense.expenseDate) === month
        ? sum + expenseAmount(expense)
        : sum,
    0,
  );
}

/** Expenses waiting on a human decision — the "pending approvals" tile. */
export function pendingCount(expenses: readonly Expense[]): number {
  return expenses.filter((expense) => expense.status === 'submitted').length;
}

/** ------------------------------------------------------------ spend pace */

/**
 * `on-track` / `watch` / `over` — a state, which is why it is allowed to be
 * painted in `status.*` colours (§2.2).
 */
export type PaceStatus = 'on-track' | 'watch' | 'over';

export interface SpendPace {
  /** Spent so far this month. */
  spent: number;
  /** Straight-line projection of where the month ends at the current rate. */
  projected: number;
  /** What the projection is measured against — total budget, or last month. */
  benchmark: number;
  /** Where the benchmark came from, so the card can say so in words. */
  benchmarkSource: 'budget' | 'last-month' | 'none';
  /** `projected / benchmark`. 0 when there is nothing to pace against. */
  ratio: number;
  /** Fraction of the month elapsed, 0–1. */
  elapsed: number;
  status: PaceStatus;
}

/**
 * Below this the month is comfortably on track; between it and 1 the projection
 * is close enough to the benchmark to be worth watching. At or above 1 the
 * current rate ends the month over.
 */
const WATCH_RATIO = 0.9;

export interface SpendPaceInput {
  spent: number;
  /** Total budgeted across categories. Zero/absent falls back to last month. */
  budgeted: number;
  lastMonthSpend: number;
  dayOfMonth: number;
  daysInMonth: number;
}

export function computeSpendPace(input: SpendPaceInput): SpendPace {
  const { spent, budgeted, lastMonthSpend, dayOfMonth, daysInMonth } = input;

  const days = daysInMonth > 0 ? daysInMonth : 1;
  const elapsed = Math.min(Math.max(dayOfMonth, 0) / days, 1);

  // Straight-line, not a real forecast: at 25% through the month, spending
  // 25% of the benchmark is exactly on pace. Before any of the month has
  // elapsed there is nothing to extrapolate from.
  const projected = elapsed > 0 ? spent / elapsed : 0;

  const benchmarkSource: SpendPace['benchmarkSource'] =
    budgeted > 0 ? 'budget' : lastMonthSpend > 0 ? 'last-month' : 'none';
  const benchmark =
    benchmarkSource === 'budget' ? budgeted : benchmarkSource === 'last-month' ? lastMonthSpend : 0;

  const ratio = benchmark > 0 ? projected / benchmark : 0;

  // With no benchmark there is no claim to make, so it reads as on-track
  // rather than inventing an alarm out of nothing.
  const status: PaceStatus =
    benchmark <= 0 ? 'on-track' : ratio >= 1 ? 'over' : ratio >= WATCH_RATIO ? 'watch' : 'on-track';

  return { spent, projected, benchmark, benchmarkSource, ratio, elapsed, status };
}

/** ---------------------------------------------------------------- trend */

export interface TrendPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  total: number;
}

function shiftDays(isoDate: string, delta: number): string {
  // Anchored at UTC noon so a ±1 day shift can never be dragged across a
  // boundary by a DST transition.
  const base = new Date(`${isoDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/**
 * Daily totals for the `days` days ending at `endDate`, inclusive. Days with no
 * expenses are present with a total of 0 — a gap in a bar chart has to be a
 * visible zero, not a missing bar, or the axis lies about the time span.
 */
export function dailyTrend(
  expenses: readonly Expense[],
  endDate: string,
  days: number,
): TrendPoint[] {
  const span = Math.max(1, Math.floor(days));

  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (!isSpend(expense)) continue;
    const key = expense.expenseDate.slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + expenseAmount(expense));
  }

  const points: TrendPoint[] = [];
  for (let offset = span - 1; offset >= 0; offset--) {
    const date = shiftDays(endDate, -offset);
    points.push({ date, total: totals.get(date) ?? 0 });
  }
  return points;
}

/** ------------------------------------------------------- bar geometry */

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarGeometryOptions {
  /** viewBox width. */
  width: number;
  /** viewBox height. */
  height: number;
  /** Horizontal gap between bars, in viewBox units. */
  gap: number;
  /** Height of a zero bar, so an empty day still reads as a day. */
  baseline: number;
}

const DEFAULT_GEOMETRY: BarGeometryOptions = { width: 100, height: 32, gap: 1.2, baseline: 1 };

/**
 * Lays values out as SVG rects in the viewBox. Separated from the template so
 * the chart's arithmetic is testable without rendering, and so no chart library
 * is needed for what is ultimately `n` rectangles.
 */
export function barGeometry(
  values: readonly number[],
  options: Partial<BarGeometryOptions> = {},
): Bar[] {
  const { width, height, gap, baseline } = { ...DEFAULT_GEOMETRY, ...options };
  if (values.length === 0) return [];

  const slot = width / values.length;
  const barWidth = Math.max(slot - gap, 0.5);
  const max = values.reduce((peak, value) => (value > peak ? value : peak), 0);

  return values.map((value, index) => {
    // An all-zero week must not paint a full-height chart, so the scale falls
    // back to the baseline rather than dividing by zero.
    const scaled = max > 0 ? (Math.max(value, 0) / max) * height : 0;
    const barHeight = Math.max(scaled, baseline);
    return {
      x: index * slot + (slot - barWidth) / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
}

/** --------------------------------------------------------- activity feed */

/**
 * Most recently filed first. Sorted on `createdAt` rather than `expenseDate`:
 * the feed is "what happened in the app", and an expense back-dated to last
 * week was still added just now.
 */
export function recentActivity(expenses: readonly Expense[], limit = 6): Expense[] {
  return [...expenses]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, Math.max(0, limit));
}
