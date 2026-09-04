import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { SET_BUDGET } from '@actuo/shared';
import type { Budget, BudgetStatus, Category } from '@actuo/shared';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { PageActions } from '../../webmcp/page-actions.js';
import { AGENT_FILL_STAGGER_MS, agentPause } from '../../core/agent/fill-pacing.js';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ProgressBar, Skeleton } from '../../ui';
import { formatMoney } from '../../core/format/money.js';
import { excludedNotice } from '../../core/expense/amount.js';
import {
  isNearBudget,
  isOverBudget,
  nearBudget,
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
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1">
                  @if (isOver(budget)) {
                    <div class="mb-2">
                      <ui-badge tone="danger" label="Over budget" />
                    </div>
                  } @else if (isNear(budget)) {
                    <div class="mb-2">
                      <ui-badge tone="warning" label="Nearing budget" />
                    </div>
                  }
                </div>
                @if (mayManage() && budgetForCategory(budget.categoryId); as b) {
                  <button
                    type="button"
                    class="text-xs text-muted underline hover:text-body"
                    (click)="startEdit(b)"
                  >
                    Edit
                  </button>
                }
              </div>

              <ui-progress-bar
                [label]="budget.categoryName"
                [value]="percent(budget)"
                [max]="100"
              />

              <p class="tabular mt-2 text-xs" data-money>
                <span class="text-muted">{{ spentOfBudgeted(budget) }}</span>
                @if (budget.carryforward > 0) {
                  <span class="text-muted"> ({{ carryText(budget) }})</span>
                }
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
            <h2 class="font-display text-lg font-semibold text-body">{{ formHeading() }}</h2>
            <p class="mt-1 text-sm text-muted">
              @if (editingBudget()) {
                Update the monthly amount or change whether unused budget carries forward.
              } @else {
                A monthly amount for one category, or for the organization as a whole.
              }
            </p>
          </header>

          <form class="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" (submit)="saveBudget($event)">
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
                [value]="selectedCategoryId()"
                (change)="selectCategory($any($event.target).value)"
              >
                @if (showOrgWideOption()) {
                  <option value="">All categories</option>
                }
                @for (category of selectableCategories(); track category.id) {
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

            <div class="flex items-center gap-2 pb-3">
              <input
                id="budget-rollover"
                type="checkbox"
                class="size-4 rounded border-line bg-surface text-brand-teal
                       focus-visible:outline-2 focus-visible:-outline-offset-1
                       focus-visible:outline-brand-teal"
                [checked]="rollover()"
                (change)="rollover.set($any($event.target).checked)"
              />
              <label for="budget-rollover" class="text-sm text-body">Roll over unused</label>
            </div>

            <button uiButton type="submit" [loading]="saving()" [disabled]="!newAmount().trim()">
              {{ editingBudget() ? 'Update' : 'Save' }}
            </button>
          </form>

          @if (editingBudget()) {
            <button
              type="button"
              class="mt-3 text-sm text-muted underline hover:text-body"
              (click)="cancelEdit()"
            >
              Cancel editing
            </button>
          }

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

  /** The budget currently being edited, or null when creating a new one. */
  protected readonly editingBudget = signal<Budget | null>(null);
  /** The category selected in the dropdown when not editing. */
  private readonly newCategoryId = signal('');
  protected readonly newAmount = signal('');
  protected readonly rollover = signal(false);
  protected readonly saving = signal(false);
  protected readonly formMessage = signal<string | null>(null);
  protected readonly formFailed = signal(false);
  protected readonly amountError = signal<string | null>(null);

  /** Categories available in the dropdown: unbudgeted ones, plus the one being edited. */
  protected readonly selectableCategories = computed(() => {
    const editing = this.editingBudget();
    const taken = new Set(this.existing().map((b) => b.categoryId));
    return this.categories().filter((category) => {
      if (editing && category.id === editing.categoryId) return true;
      return !taken.has(category.id);
    });
  });

  /** The category ID shown in the select — the editing one, or user's selection. */
  protected readonly selectedCategoryId = computed(() => {
    const editing = this.editingBudget();
    if (editing) return editing.categoryId ?? '';
    return this.newCategoryId();
  });

  /** Whether the "All categories" option should appear in the dropdown. */
  protected readonly showOrgWideOption = computed(() => {
    const editing = this.editingBudget();
    // Show if editing the org-wide budget, or if no org-wide budget exists yet
    return (editing && editing.categoryId === null) || !this.orgBudgetExists();
  });

  protected readonly formHeading = computed(() => {
    const editing = this.editingBudget();
    if (editing) {
      const name = editing.categoryId
        ? this.categories().find((c) => c.id === editing.categoryId)?.name ?? 'category'
        : 'all categories';
      return `Edit budget for ${name}`;
    }
    return 'Set a budget';
  });

  private readonly pages = inject(PageActions);
  private readonly destroyRef = inject(DestroyRef);

  /** Overridden to 0 in tests, which have no interest in watching it fill. */
  protected fillStaggerMs = AGENT_FILL_STAGGER_MS;

  constructor() {
    // Categories only matter to someone who can set a budget, and only in the
    // browser — `ApiClient` refuses to run during SSR.
    if (this.isBrowser) void this.loadCategories();

    /*
     * This page owns `set_budget`. A person cannot change a budget without
     * coming here and using this form, so neither does an agent: the tool
     * navigates here and hands the values over, and the form fills and saves in
     * front of the user.
     */
    this.destroyRef.onDestroy(
      this.pages.provide(SET_BUDGET.name, (args: SetBudgetArgs) => this.setFromAgent(args)),
    );
  }

  /**
   * Fill the visible form with an agent's values and save it.
   *
   * Routed through `commit()`, which is exactly what the Save button calls, so
   * the validation, the success message and the bar reload are the same ones a
   * person gets. Waiting for the categories keeps the `<select>` from showing a
   * blank while the agent's choice is already set.
   */
  private async setFromAgent(args: SetBudgetArgs): Promise<unknown> {
    if (this.existing().length === 0 && this.categories().length === 0) {
      await this.loadCategories();
    }

    const categoryId = args.categoryId ?? null;
    const existing = this.existing().find((b) => (b.categoryId ?? null) === categoryId);

    // Editing and creating are different requests; `startEdit` is what tells
    // the form (and `commit`) which one this is.
    if (existing) this.startEdit(existing);
    else {
      this.editingBudget.set(null);
      this.newCategoryId.set(categoryId ?? '');
    }

    this.newAmount.set(String(args.amount));
    this.rollover.set(args.rollover ?? existing?.rollover ?? false);

    /*
     * Let the filled form reach the screen before saving it. Without this the
     * fill and the save land in the same frame, so there is no frame in which
     * the user sees what the agent chose — which is the whole reason this goes
     * through the form instead of posting behind it.
     */
    await agentPause(this.fillStaggerMs);

    await this.commit();

    /*
     * `commit()` reports two different refusals: the amount check writes
     * `amountError` and returns without ever calling the API, while a rejected
     * request sets `formFailed`. Both have to reach the agent as errors, or a
     * budget that was never saved comes back looking saved.
     */
    const refusal = this.amountError() ?? (this.formFailed() ? this.formMessage() : null);
    if (refusal) throw new Error(refusal);

    const saved = this.existing().find((b) => (b.categoryId ?? null) === categoryId);
    return {
      categoryId,
      amount: saved?.amount ?? args.amount,
      rollover: saved?.rollover ?? args.rollover ?? false,
      created: !existing,
    };
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

  protected selectCategory(value: string): void {
    // When switching categories, if the target has an existing budget, switch to edit mode.
    const categoryId = value || null;
    const budget = this.existing().find((b) => b.categoryId === categoryId);
    if (budget) {
      this.startEdit(budget);
    } else {
      this.editingBudget.set(null);
      this.newCategoryId.set(value);
      this.newAmount.set('');
      this.rollover.set(false);
    }
  }

  protected startEdit(budget: Budget): void {
    this.editingBudget.set(budget);
    this.newAmount.set(String(budget.amount));
    this.rollover.set(budget.rollover);
    this.formMessage.set(null);
  }

  protected cancelEdit(): void {
    this.editingBudget.set(null);
    this.newCategoryId.set('');
    this.newAmount.set('');
    this.rollover.set(false);
    this.formMessage.set(null);
  }

  /** Finds the budget for a category, so the template can offer an edit button. */
  protected budgetForCategory(categoryId: string | null): Budget | undefined {
    return this.existing().find((b) => b.categoryId === categoryId);
  }

  protected async saveBudget(event: Event): Promise<void> {
    event.preventDefault();
    await this.commit();
  }

  /**
   * Save whatever the form currently holds.
   *
   * Split out of `saveBudget` so the agent-driven path and the Save button are
   * the same code: the only thing the button adds is `preventDefault()`.
   */
  private async commit(): Promise<void> {
    this.formMessage.set(null);
    this.amountError.set(null);

    const amount = Number(this.newAmount());
    if (!Number.isFinite(amount) || amount <= 0) {
      this.amountError.set('Enter an amount greater than zero.');
      return;
    }

    const editing = this.editingBudget();
    this.saving.set(true);
    try {
      if (editing) {
        // PATCH existing budget
        await this.api.patch<Budget>(`/budgets/${editing.id}`, {
          amount: Math.round(amount * 100) / 100,
          rollover: this.rollover(),
        });
        this.formMessage.set('Budget updated.');
      } else {
        // POST new budget
        await this.api.post<Budget>('/budgets', {
          categoryId: this.selectedCategoryId() || null,
          amount: Math.round(amount * 100) / 100,
          period: 'monthly',
          rollover: this.rollover(),
        });
        this.formMessage.set('Budget saved.');
      }
      this.formFailed.set(false);
      this.newCategoryId.set('');
      this.newAmount.set('');
      this.rollover.set(false);
      this.editingBudget.set(null);
      // Reload bars and the existing list.
      this.data.reload();
      void this.loadCategories();
    } catch (error) {
      this.formFailed.set(true);
      this.formMessage.set(describeBudgetFailure(error, !!editing));
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

  protected isNear(status: BudgetStatus): boolean {
    return isNearBudget(status);
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

  /** Explains that budgeted includes carry: "₹50,000 + ₹8,000 carried". */
  protected carryText(status: BudgetStatus): string {
    return `${this.money(status.declaredBudget, status)} + ${this.money(status.carryforward, status)} carried`;
  }

  reload(): void {
    this.data.reload();
  }
}

/** Actionable, never blaming (Design Doc §3.6). */
function describeBudgetFailure(error: unknown, isUpdate = false): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Only an owner or admin can manage budgets.';
    if (error.status === 404) return 'That budget no longer exists.';
    if (error.status === 409) {
      return 'That category already has a budget.';
    }
    if (error.status === 0) return "Actuo didn't respond, so nothing was saved. Try again.";
    if (error.message) return error.message;
  }
  return isUpdate
    ? 'That budget could not be updated. Nothing was changed.'
    : 'That budget could not be saved. Nothing was changed.';
}

type SetBudgetArgs = {
  categoryId?: string;
  amount: number;
  rollover?: boolean;
};
