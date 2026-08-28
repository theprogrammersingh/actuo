import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  resource,
} from '@angular/core';
import type { BudgetStatus, Expense, Organization, Page } from '@actuo/shared';

import { ApiClient } from '../../core/api/api-client.js';
import { Card, EmptyState, ErrorState, Skeleton, StatCard } from '../../ui';
import { formatDay, formatMoney } from '../../core/format/money.js';
import {
  barGeometry,
  computeSpendPace,
  dailyTrend,
  expenseAmount,
  pendingCount,
  recentActivity,
  spendWindow,
  totalForMonth,
  type PaceStatus,
} from './spend-pace.js';

/** Days of history in the trend strip. Two weeks fits 14 legible bars on a phone. */
const TREND_DAYS = 14;

/** Rows in the activity feed — enough to show a pattern, short enough to scan. */
const ACTIVITY_LIMIT = 6;

/**
 * How many rows the dashboard pulls. It needs this month plus last month, and
 * the figures are sums, so a truncated page would quietly understate them —
 * hence a ceiling well above a plausible two-month volume rather than the
 * API's default page size.
 */
const FETCH_LIMIT = 500;

interface DashboardData {
  expenses: Expense[];
  budgets: BudgetStatus[];
  currency: string;
}

const PACE_LABEL: Record<PaceStatus, string> = {
  'on-track': 'On track',
  watch: 'Running close',
  over: 'Over pace',
};

/**
 * Design Doc §3.3 — hero summary tiles, a trend strip, and a recent-activity
 * feed.
 *
 * Everything is derived client-side from one expenses fetch: there is no
 * `/api/analytics/*`, and the arithmetic lives in `spend-pace.ts` as pure
 * functions so it is testable without a fixture.
 *
 * §2.2's scarcity rule is spent deliberately here: the spend-pace tile is the
 * **only** aurora element on this screen, which is why the trend bars use a
 * flat brand accent instead of the gradient.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Card, EmptyState, ErrorState, Skeleton, StatCard],
  host: { class: 'block' },
  template: `
    <section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header class="mb-5 sm:mb-6">
        <h1 class="font-display text-2xl font-semibold text-body sm:text-3xl">Dashboard</h1>
        <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
      </header>

      @if (failed()) {
        <ui-error-state
          heading="The dashboard didn’t load"
          message="Your expenses are safe — the figures just didn’t come back. Try again in a moment."
          [detail]="errorDetail()"
          (retry)="reload()"
        />
      } @else if (pending()) {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (tile of skeletonTiles; track tile) {
            <ui-skeleton shape="card" label="Loading this month’s figures" />
          }
        </div>
        <div class="mt-6 grid gap-4 lg:grid-cols-5">
          <div class="lg:col-span-3">
            <ui-skeleton shape="block" height="10rem" label="Loading the spend trend" />
          </div>
          <div class="lg:col-span-2">
            <ui-skeleton shape="list" [lines]="4" label="Loading recent activity" />
          </div>
        </div>
      } @else if (isEmpty()) {
        <ui-empty-state
          heading="Nothing to report yet"
          message="Add your first expense — or ask the Copilot to log one for you — and this
                   page fills in with your spend, your pace against budget, and what’s
                   waiting on approval."
          [headingLevel]="2"
        />
      } @else {
        <!-- Single column on a phone; the grid only starts at sm. -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- The one aurora element on this screen (§2.2). -->
          <ui-stat-card
            aurora
            label="Spend pace"
            [value]="paceLabel()"
            [money]="false"
            [delta]="paceDelta()"
            [deltaTone]="paceTone()"
            [deltaLabel]="paceDeltaLabel()"
            [hint]="paceHint()"
          />

          <ui-stat-card
            label="This month"
            [value]="monthSpendText()"
            [delta]="monthDelta()"
            deltaLabel="vs last month"
            [hint]="monthHint()"
          />

          <ui-stat-card
            label="Budget remaining"
            [value]="remainingText()"
            [money]="hasBudgets()"
            [hint]="remainingHint()"
          />

          <ui-stat-card
            label="Pending approvals"
            [value]="pendingText()"
            [money]="false"
            [hint]="pendingHint()"
          />
        </div>

        <div class="mt-6 grid gap-4 lg:grid-cols-5">
          <div class="lg:col-span-3">
            <ui-card>
              <div uiCardHeader class="mb-4 flex items-baseline justify-between gap-3">
                <h2 class="text-sm font-semibold text-body">Last {{ trendDays }} days</h2>
                <span class="tabular text-xs text-muted" data-money>{{ trendTotalText() }}</span>
              </div>

              <!--
              Inline SVG rather than a chart library: this is n rectangles, and
              a dependency would buy nothing. preserveAspectRatio="none" lets
              the bars stretch to the container — safe because rects here have
              no stroke to distort.
            -->
              <svg
                class="h-28 w-full text-brand-teal"
                [attr.viewBox]="'0 0 100 ' + trendHeight"
                preserveAspectRatio="none"
                role="img"
                [attr.aria-label]="trendLabel()"
              >
                @for (bar of trendBars(); track bar.date) {
                  <rect
                    [attr.x]="bar.x"
                    [attr.y]="bar.y"
                    [attr.width]="bar.width"
                    [attr.height]="bar.height"
                    fill="currentColor"
                    [attr.opacity]="bar.total > 0 ? 0.85 : 0.25"
                  />
                }
              </svg>

              <div class="mt-2 flex justify-between text-xs text-muted">
                <span>{{ trendStartLabel() }}</span>
                <span>{{ trendEndLabel() }}</span>
              </div>
            </ui-card>
          </div>

          <div class="lg:col-span-2">
            <ui-card>
              <h2 uiCardHeader class="mb-3 text-sm font-semibold text-body">Recent activity</h2>

              @if (activity().length === 0) {
                <p class="py-6 text-center text-sm text-muted">Nothing filed in this window yet.</p>
              } @else {
                <ul class="divide-y divide-line">
                  @for (item of activity(); track item.id) {
                    <li class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium text-body">
                          {{ item.merchant || 'Untitled expense' }}
                        </p>
                        <p class="mt-0.5 text-xs text-muted">
                          {{ formatDay(item.expenseDate) }} · {{ statusLabel(item) }}
                        </p>
                      </div>
                      <span class="tabular shrink-0 text-sm font-medium text-body" data-money>
                        {{ amountText(item) }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </ui-card>
          </div>
        </div>
      }
    </section>
  `,
})
export class Dashboard {
  private readonly api = inject(ApiClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly trendDays = TREND_DAYS;
  protected readonly trendHeight = 32;
  protected readonly skeletonTiles = [0, 1, 2, 3];
  protected readonly formatDay = formatDay;

  /** Resolved once per instance so every derived figure agrees on "today". */
  private readonly window = spendWindow(new Date());

  /**
   * `params` is undefined on the server, which parks the resource in `idle`
   * and skips the loader entirely — `ApiClient` refuses to run during SSR, and
   * rendering an error state into the SSR payload would flash a false failure
   * before hydration replaces it.
   */
  readonly data = resource<DashboardData, { from: string; to: string } | undefined>({
    params: () => (this.isBrowser ? { from: this.window.from, to: this.window.to } : undefined),
    loader: async ({ params, abortSignal }): Promise<DashboardData> => {
      const [page, budgets, org] = await Promise.all([
        this.api.get<Page<Expense>>(
          '/expenses',
          { from: params.from, to: params.to, limit: FETCH_LIMIT },
          abortSignal,
        ),
        this.api.get<BudgetStatus[]>('/budgets/status', undefined, abortSignal),
        this.api.get<Organization>('/orgs/current', undefined, abortSignal),
      ]);

      return { expenses: page.items ?? [], budgets: budgets ?? [], currency: org.baseCurrency };
    },
  });

  // --- view state ----------------------------------------------------------

  private readonly loaded = computed<DashboardData | null>(() =>
    this.data.hasValue() ? this.data.value() : null,
  );

  protected readonly failed = computed(() => this.data.status() === 'error');

  /** Idle (SSR) reads as pending too, so the server renders skeletons, not a blank. */
  protected readonly pending = computed(() => !this.data.hasValue() && !this.failed());

  protected readonly errorDetail = computed(() => {
    const error = this.data.error();
    return error instanceof Error ? error.message : null;
  });

  private readonly expenses = computed(() => this.loaded()?.expenses ?? []);
  private readonly budgets = computed(() => this.loaded()?.budgets ?? []);
  private readonly currency = computed(() => this.loaded()?.currency ?? 'INR');

  protected readonly isEmpty = computed(
    () => this.expenses().length === 0 && this.budgets().length === 0,
  );

  protected readonly subtitle = computed(() =>
    this.pending() ? 'Pulling this month’s figures…' : 'Where this month stands so far.',
  );

  // --- figures -------------------------------------------------------------

  private readonly monthSpend = computed(() => totalForMonth(this.expenses(), this.window.month));
  private readonly lastMonthSpend = computed(() =>
    totalForMonth(this.expenses(), this.window.previousMonth),
  );

  protected readonly hasBudgets = computed(() => this.budgets().length > 0);

  private readonly budgeted = computed(() =>
    this.budgets().reduce((sum, budget) => sum + budget.budgeted, 0),
  );
  private readonly remaining = computed(() =>
    this.budgets().reduce((sum, budget) => sum + budget.remaining, 0),
  );

  private readonly pace = computed(() =>
    computeSpendPace({
      spent: this.monthSpend(),
      budgeted: this.budgeted(),
      lastMonthSpend: this.lastMonthSpend(),
      dayOfMonth: this.window.dayOfMonth,
      daysInMonth: this.window.daysInMonth,
    }),
  );

  protected readonly paceLabel = computed(() => PACE_LABEL[this.pace().status]);

  /** Percent above/below the benchmark; null when there is nothing to pace against. */
  protected readonly paceDelta = computed(() => {
    const pace = this.pace();
    if (pace.benchmarkSource === 'none') return null;
    return Math.round((pace.ratio - 1) * 100);
  });

  /**
   * Tone follows the pace *state*, not the sign of the number — under budget is
   * good news whichever direction the arrow points.
   */
  protected readonly paceTone = computed(() => {
    switch (this.pace().status) {
      case 'over':
        return 'negative' as const;
      case 'watch':
        return 'neutral' as const;
      default:
        return 'positive' as const;
    }
  });

  protected readonly paceDeltaLabel = computed(() =>
    this.pace().benchmarkSource === 'budget' ? 'vs budget' : 'vs last month',
  );

  protected readonly paceHint = computed(() => {
    const pace = this.pace();
    if (pace.benchmarkSource === 'none') {
      return 'Set a category budget to pace this month against something.';
    }
    const projected = formatMoney(Math.round(pace.projected), this.currency());
    const benchmark = formatMoney(Math.round(pace.benchmark), this.currency());
    return `On track for ${projected} by month end · ${benchmark} ${
      pace.benchmarkSource === 'budget' ? 'budgeted' : 'last month'
    }`;
  });

  protected readonly monthSpendText = computed(() =>
    formatMoney(this.monthSpend(), this.currency()),
  );

  protected readonly monthDelta = computed(() => {
    const last = this.lastMonthSpend();
    if (last <= 0) return null;
    return Math.round((this.monthSpend() / last - 1) * 100);
  });

  protected readonly monthHint = computed(() => {
    const count = this.expenses().filter((expense) =>
      expense.expenseDate.startsWith(this.window.month),
    ).length;
    return `${count} ${count === 1 ? 'expense' : 'expenses'} so far`;
  });

  protected readonly remainingText = computed(() =>
    this.hasBudgets() ? formatMoney(this.remaining(), this.currency()) : 'No budgets',
  );

  protected readonly remainingHint = computed(() => {
    const count = this.budgets().length;
    if (count === 0) return 'Add a budget to track what’s left.';
    return `across ${count} ${count === 1 ? 'category' : 'categories'}`;
  });

  private readonly pendingApprovals = computed(() => pendingCount(this.expenses()));

  protected readonly pendingText = computed(() => String(this.pendingApprovals()));

  protected readonly pendingHint = computed(() => {
    const submitted = this.expenses().filter((expense) => expense.status === 'submitted');
    if (submitted.length === 0) return 'Nothing waiting on a decision.';
    const total = submitted.reduce((sum, expense) => sum + expenseAmount(expense), 0);
    return `${formatMoney(total, this.currency())} awaiting a decision`;
  });

  // --- trend ---------------------------------------------------------------

  private readonly trendPoints = computed(() =>
    dailyTrend(this.expenses(), this.window.to, TREND_DAYS),
  );

  protected readonly trendBars = computed(() => {
    const points = this.trendPoints();
    const bars = barGeometry(
      points.map((point) => point.total),
      { height: this.trendHeight },
    );
    return points.map((point, index) => ({ ...point, ...bars[index] }));
  });

  protected readonly trendTotalText = computed(() =>
    formatMoney(
      this.trendPoints().reduce((sum, point) => sum + point.total, 0),
      this.currency(),
    ),
  );

  protected readonly trendStartLabel = computed(() => {
    const first = this.trendPoints()[0];
    return first ? formatDay(first.date) : '';
  });

  protected readonly trendEndLabel = computed(() => {
    const points = this.trendPoints();
    return points.length > 0 ? 'Today' : '';
  });

  /**
   * The chart's accessible name. A bar chart with no text alternative is
   * invisible to a screen reader, so the peak day is stated in words (§3.5).
   */
  protected readonly trendLabel = computed(() => {
    const points = this.trendPoints();
    const peak = points.reduce(
      (best, point) => (point.total > best.total ? point : best),
      points[0] ?? { date: '', total: 0 },
    );
    if (peak.total <= 0) {
      return `Daily spend for the last ${TREND_DAYS} days: nothing recorded.`;
    }
    return `Daily spend for the last ${TREND_DAYS} days. Highest was ${formatMoney(
      peak.total,
      this.currency(),
    )} on ${formatDay(peak.date)}.`;
  });

  // --- activity ------------------------------------------------------------

  protected readonly activity = computed(() => recentActivity(this.expenses(), ACTIVITY_LIMIT));

  protected amountText(expense: Expense): string {
    return formatMoney(expenseAmount(expense), expense.baseCurrency || this.currency());
  }

  protected statusLabel(expense: Expense): string {
    return expense.status.charAt(0).toUpperCase() + expense.status.slice(1);
  }

  reload(): void {
    this.data.reload();
  }
}
