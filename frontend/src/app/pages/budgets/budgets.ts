import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import type { Budget, BudgetStatus, Category } from '@actuo/shared';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ProgressBar, Skeleton } from '../../ui';
import { formatMoney } from '../../core/format/money.js';
import { excludedNotice } from '../../core/expense/amount.js';
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
  imports: [Badge, Button, Card, EmptyState, ErrorState, Input, ProgressBar, Skeleton],
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

          <!--
            Muted, not status.danger: this says what the figure could not
            account for, which is information rather than a state to act on.
          -->
          @if (excludedNote(); as note) {
            <p class="mt-2 text-xs text-muted" role="status">{{ note }}</p>
          }
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

      <!--
        PRD §6.3. POST /api/budgets existed with no caller at all, which made the
        empty state's advice to "add the first one" impossible to follow. Shown
        only to owner/admin, matching the route's own Roles list — a member sees
        the page without a control that would 403.
      -->
      @if (mayManage()) {
        <ui-card padding="lg" class="mt-6 block">
          <header uiCardHeader class="mb-4">
            <h2 class="font-display text-lg font-semibold text-body">Set a budget</h2>
            <p class="mt-1 text-sm text-muted">
              A monthly amount for one category, or for the organization as a whole. Each can
              have one budget, so only the categories without one are listed.
            </p>
          </header>

          @if (unbudgeted().length === 0 && orgBudgetExists()) {
            <p class="text-sm text-muted">
              Every category already has a budget. Changing one is not supported yet — the API
              creates budgets and does not replace them.
            </p>
          } @else {
          <form class="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" (submit)="saveBudget($event)">
            <div>
              <label for="budget-category" class="mb-1.5 block text-sm font-medium text-body">
                Category
              </label>
              <select
                id="budget-category"
                name="categoryId"
                class="block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2
                       text-sm text-body transition-colors duration-150 ease-out
                       focus-visible:outline-2 focus-visible:-outline-offset-1
                       focus-visible:outline-brand-teal"
                [value]="newCategoryId()"
                (change)="newCategoryId.set($any($event.target).value)"
              >
                @if (!orgBudgetExists()) {
                  <option value="">All categories</option>
                }
                @for (category of unbudgeted(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </select>
            </div>

            <div class="sm:w-40">
              <ui-input
                label="Monthly amount"
                type="number"
                inputmode="decimal"
                placeholder="10000"
                [error]="amountError()"
                [value]="newAmount()"
                (valueChange)="newAmount.set($event)"
              />
            </div>

            <button uiButton type="submit" [loading]="saving()" [disabled]="!newAmount().trim()">
              Save budget
            </button>
          </form>

          @if (formMessage(); as message) {
            <p
              class="mt-3 text-sm"
              [class.text-status-danger]="formFailed()"
              [class.text-status-success]="!formFailed()"
              role="status"
            >
              {{ message }}
            </p>
          }
          }
        </ui-card>
      }
    </section>
  `,
})
export class Budgets {
  private readonly api = inject(ApiClient);
  private readonly session = inject(Session);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // --- setting a budget (PRD §6.3) -----------------------------------------

  /**
   * Mirrors `@Roles('owner','admin')` on `POST /api/budgets`. The server is the
   * enforcer; hiding the form just avoids offering a control that would 403.
   */
  protected readonly mayManage = computed(() => {
    const role = this.session.role();
    return role === 'owner' || role === 'admin';
  });

  protected readonly categories = signal<readonly Category[]>([]);
  /** Existing budget rows, so the form cannot offer a category that would 409. */
  private readonly existing = signal<readonly Budget[]>([]);

  /**
   * `POST /api/budgets` inserts; a unique index on (org_id, category_id) makes a
   * second one a 409. So the dropdown lists only what can actually be created —
   * the same principle as the expense action buttons.
   */
  protected readonly unbudgeted = computed(() => {
    const taken = new Set(this.existing().map((budget) => budget.categoryId));
    return this.categories().filter((category) => !taken.has(category.id));
  });

  protected readonly orgBudgetExists = computed(() =>
    this.existing().some((budget) => budget.categoryId === null),
  );
  protected readonly newCategoryId = signal('');
  protected readonly newAmount = signal('');
  protected readonly saving = signal(false);
  protected readonly formMessage = signal<string | null>(null);
  protected readonly formFailed = signal(false);
  protected readonly amountError = signal<string | null>(null);

  constructor() {
    // Categories only matter to someone who can set a budget, and only in the
    // browser — `ApiClient` refuses to run during SSR.
    if (this.isBrowser) void this.loadCategories();
  }

  private async loadCategories(): Promise<void> {
    try {
      const [categories, budgets] = await Promise.all([
        this.api.get<Category[]>('/orgs/current/categories'),
        this.api.get<Budget[]>('/budgets'),
      ]);
      this.categories.set(categories);
      this.existing.set(budgets);
    } catch {
      // The form still works against "All categories", which is the org-wide
      // budget. A missing list is a smaller problem than a blocked form.
    }
  }

  protected async saveBudget(event: Event): Promise<void> {
    event.preventDefault();
    this.formMessage.set(null);
    this.amountError.set(null);

    const amount = Number(this.newAmount());
    if (!Number.isFinite(amount) || amount <= 0) {
      this.amountError.set('Enter an amount greater than zero.');
      return;
    }

    this.saving.set(true);
    try {
      await this.api.post<Budget>('/budgets', {
        // '' is the org-wide budget, which the DTO expects as null rather than
        // an empty string.
        categoryId: this.newCategoryId() || null,
        amount: Math.round(amount * 100) / 100,
        period: 'monthly',
        // No `rollover`: nothing reads the flag — `status()` always computes a
        // fresh calendar month — so the form stopped offering it (PRD §6.3).
      });
      this.formFailed.set(false);
      this.formMessage.set('Budget saved.');
      this.newAmount.set('');
      this.newCategoryId.set('');
      // The bars are server-computed, so the figures have to come back from it,
      // and the dropdown has to drop the category that now has one.
      this.data.reload();
      void this.loadCategories();
    } catch (error) {
      this.formFailed.set(true);
      this.formMessage.set(describeBudgetFailure(error));
    } finally {
      this.saving.set(false);
    }
  }

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

  /**
   * `spent` counts only expenses that have a value in the org's base currency
   * (PRD §6.5 — there is no FX pass). Saying so keeps a partial figure from
   * reading as a complete one.
   */
  protected readonly excludedNote = computed(() =>
    excludedNotice(this.rollup().unconvertedCount),
  );

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

/** Actionable, never blaming (Design Doc §3.6). */
function describeBudgetFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Only an owner or admin can set a budget.';
    if (error.status === 409) {
      return 'That category already has a budget. Changing an existing one is not supported yet.';
    }
    if (error.status === 0) return 'Actuo didn’t respond, so nothing was saved. Try again.';
    if (error.message) return error.message;
  }
  return 'That budget could not be saved. Nothing was changed.';
}
