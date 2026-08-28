import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  resource,
} from '@angular/core';
import type { BudgetStatus } from '@actuo/shared';

import { ApiClient } from '../../core/api/api-client.js';
import { Badge, Card, EmptyState, ErrorState, ProgressBar, Skeleton } from '../../ui';
import { formatMoney } from '../../core/format/money.js';
import {
  isOverBudget,
  overBudget,
  overspend,
  rollupBudgets,
  sortBudgets,
  utilizationPercent,
} from './budget-rollup.js';

/**
 * Design Doc §3.3 — a progress bar per category, ramping
 * `status.success → status.warning → status.danger` as usage climbs.
 *
 * `ProgressBar` owns the ramp and the "Over by N%" line, so this screen never
 * picks a colour itself. What it adds is the part a bar cannot say on its own:
 * over-budget categories are called out explicitly at the top and badged in the
 * list, because a red bar among several is easy to miss and being over budget
 * is the one fact on this page that needs acting on.
 */
@Component({
  selector: 'app-budgets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Card, EmptyState, ErrorState, ProgressBar, Skeleton],
  host: { class: 'block' },
  template: `
    <section class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header class="mb-5">
        <h1 class="font-display text-2xl font-semibold text-body sm:text-3xl">Budgets</h1>
        <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
      </header>

      @if (failed()) {
        <ui-error-state
          heading="Budgets didn’t load"
          message="Your budgets are untouched — the figures just didn’t come back. Try again in a moment."
          [detail]="errorDetail()"
          (retry)="reload()"
        />
      } @else if (pending()) {
        <ui-skeleton shape="card" label="Loading budget totals" />
        <div class="mt-4">
          <ui-skeleton shape="list" [lines]="5" label="Loading budgets by category" />
        </div>
      } @else if (budgets().length === 0) {
        <ui-empty-state
          heading="No budgets set yet"
          message="Set a monthly amount for a category and this page tracks what’s left as
                   expenses come in. An owner or admin can add the first one from Settings."
          [headingLevel]="2"
        />
      } @else {
        @if (over().length > 0) {
          <!--
            status.danger as a genuine state signal (§2.2), and it is announced:
            crossing a budget is exactly the moment a person needs to be told,
            not left to notice a colour.
          -->
          <div class="mb-5 rounded-xl border border-status-danger/30 bg-surface p-4" role="status">
            <p class="text-sm font-semibold text-status-danger">{{ overHeading() }}</p>
            <p class="mt-1 text-sm text-muted">{{ overDetail() }}</p>
          </div>
        }

        <ui-card>
          <div uiCardHeader class="mb-3 flex items-baseline justify-between gap-3">
            <h2 class="text-sm font-semibold text-body">All categories</h2>
            <span class="tabular text-xs text-muted" data-money>{{ totalsText() }}</span>
          </div>

          <ui-progress-bar
            [value]="totalPercent()"
            [max]="100"
            ariaLabel="Total budget used across all categories"
          />

          <p class="mt-2 text-xs text-muted">{{ totalsHint() }}</p>
        </ui-card>

        <h2 class="mt-6 mb-3 text-sm font-semibold text-body">By category</h2>

        <ul class="space-y-3">
          @for (budget of budgets(); track budget.categoryId ?? budget.categoryName) {
            <li class="rounded-xl border border-line bg-card p-4">
              @if (isOver(budget)) {
                <div class="mb-2">
                  <ui-badge tone="danger" label="Over budget" />
                </div>
              }

              <ui-progress-bar
                [label]="budget.categoryName"
                [value]="percent(budget)"
                [max]="100"
              />

              <p class="tabular mt-2 text-xs" data-money>
                <span class="text-muted">{{ spentOfBudgeted(budget) }}</span>
                <span aria-hidden="true" class="text-muted"> · </span>
                <span [class]="remainingClass(budget)">{{ remainingText(budget) }}</span>
              </p>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class Budgets {
  private readonly api = inject(ApiClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * `undefined` params park the resource in `idle` on the server: `ApiClient`
   * refuses to run during SSR, and rendering an error state into the SSR
   * payload would flash a false failure before hydration replaces it.
   */
  readonly data = resource<BudgetStatus[], { scope: 'current' } | undefined>({
    params: () => (this.isBrowser ? { scope: 'current' as const } : undefined),
    loader: ({ abortSignal }) =>
      this.api.get<BudgetStatus[]>('/budgets/status', undefined, abortSignal),
  });

  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));

  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly pending = computed(() => !this.data.hasValue() && !this.failed());

  protected readonly errorDetail = computed(() => {
    const error = this.data.error();
    return error instanceof Error ? error.message : null;
  });

  /** Tightest first, so the categories in trouble are above the fold. */
  readonly budgets = computed(() => sortBudgets(this.loaded() ?? []));

  readonly over = computed(() => overBudget(this.budgets()));

  private readonly rollup = computed(() => rollupBudgets(this.budgets()));

  // --- copy ----------------------------------------------------------------

  protected readonly subtitle = computed(() => {
    if (this.pending()) return 'Checking where each category stands…';
    const rollup = this.rollup();
    if (rollup.categoryCount === 0) return 'Nothing budgeted yet.';
    return `This month across ${rollup.categoryCount} ${
      rollup.categoryCount === 1 ? 'category' : 'categories'
    }.`;
  });

  protected readonly overHeading = computed(() => {
    const over = this.over();
    if (over.length === 1) return `${over[0].categoryName} is over budget`;
    return `${over.length} categories are over budget`;
  });

  protected readonly overDetail = computed(() => {
    const rollup = this.rollup();
    const names = this.over()
      .map((status) => `${status.categoryName} (${this.money(overspend(status), status)} over)`)
      .join(', ');
    return `${names}. That’s ${formatMoney(rollup.overspend, rollup.currency)} past the limit in total.`;
  });

  protected readonly totalPercent = computed(() => {
    const rollup = this.rollup();
    return rollup.budgeted > 0 ? (rollup.spent / rollup.budgeted) * 100 : 0;
  });

  protected readonly totalsText = computed(() => {
    const rollup = this.rollup();
    return `${formatMoney(rollup.spent, rollup.currency)} of ${formatMoney(
      rollup.budgeted,
      rollup.currency,
    )}`;
  });

  protected readonly totalsHint = computed(() => {
    const rollup = this.rollup();
    if (rollup.remaining < 0) {
      return `${formatMoney(Math.abs(rollup.remaining), rollup.currency)} over budget overall.`;
    }
    return `${formatMoney(rollup.remaining, rollup.currency)} left this month.`;
  });

  // --- per row -------------------------------------------------------------

  protected percent(status: BudgetStatus): number {
    return utilizationPercent(status);
  }

  protected isOver(status: BudgetStatus): boolean {
    return isOverBudget(status);
  }

  protected spentOfBudgeted(status: BudgetStatus): string {
    return `${this.money(status.spent, status)} of ${this.money(status.budgeted, status)}`;
  }

  protected remainingText(status: BudgetStatus): string {
    if (status.remaining < 0) return `${this.money(Math.abs(status.remaining), status)} over`;
    return `${this.money(status.remaining, status)} left`;
  }

  /** Only the over-budget case earns a status colour; the rest stays muted. */
  protected remainingClass(status: BudgetStatus): string {
    return status.remaining < 0 ? 'font-medium text-status-danger' : 'text-muted';
  }

  private money(amount: number, status: BudgetStatus): string {
    return formatMoney(amount, status.currency);
  }

  reload(): void {
    this.data.reload();
  }
}
