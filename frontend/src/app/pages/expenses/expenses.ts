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
import type { Expense, Page } from '@actuo/shared';

import { ApiClient } from '../../core/api/api-client.js';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton } from '../../ui';
import { formatDate, formatMoney } from '../../core/format/money.js';
import { expenseAmount } from '../../core/expense/amount.js';
import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  STATUS_OPTIONS,
  applyTableState,
  ariaSort,
  isFiltering,
  nextSort,
  type SortKey,
  type StatusFilter,
} from './expense-filter.js';

/**
 * One generous page. Filtering and sorting happen in the browser (see
 * `expense-filter.ts`), so this is the working set the screen operates on.
 */
const FETCH_LIMIT = 200;

/**
 * Design Doc §3.3 — the dense, sortable, filterable expenses table, with
 * row-level status pills.
 *
 * The same rows are rendered twice: a real `<table>` from `md:` up, and stacked
 * cards below it. §3.1 is mobile-first, and a four-column financial table on a
 * 390px screen either scrolls sideways (which hides the amount, the one column
 * people came for) or shrinks below a readable size. Duplicated markup is the
 * cheaper of the two costs, and the mobile list is the one marked up as a list
 * so screen readers get a sensible structure either way.
 */
@Component({
  selector: 'app-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Button, EmptyState, ErrorState, Input, Skeleton],
  host: { class: 'block' },
  template: `
    <section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header class="mb-5">
        <h1 class="font-display text-2xl font-semibold text-body sm:text-3xl">Expenses</h1>
        <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
      </header>

      <!-- Filters stay mounted through every state: losing what you typed
           because the retry is still in flight is its own small betrayal. -->
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="sm:max-w-xs sm:flex-1">
          <ui-input
            label="Search"
            type="search"
            placeholder="Merchant, note or amount"
            [value]="text()"
            (valueChange)="text.set($event)"
          />
        </div>

        <div class="sm:w-48">
          <label for="expense-status" class="mb-1.5 block text-sm font-medium text-body">
            Status
          </label>
          <select
            id="expense-status"
            class="block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2
                   text-sm text-body transition-colors duration-150 ease-out
                   focus-visible:outline-2 focus-visible:-outline-offset-1
                   focus-visible:outline-brand-teal"
            [value]="status()"
            (change)="onStatusChange($event)"
          >
            @for (option of statusOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>

        @if (filtering()) {
          <button uiButton variant="ghost" size="md" (click)="clearFilters()">Clear</button>
        }
      </div>

      @if (failed()) {
        <ui-error-state
          heading="The expense list didn’t load"
          message="Nothing was changed. The request didn’t come back — try again, or give it a moment."
          [detail]="errorDetail()"
          (retry)="reload()"
        />
      } @else if (pending()) {
        <div class="hidden md:block">
          <ui-skeleton shape="table" [rows]="8" [columns]="4" label="Loading expenses" />
        </div>
        <div class="md:hidden">
          <ui-skeleton shape="list" [lines]="6" label="Loading expenses" />
        </div>
      } @else if (noExpensesAtAll()) {
        <ui-empty-state
          heading="No expenses yet"
          message="Add your first expense — or ask the Copilot to log one for you — and it shows
                   up here the moment it’s filed."
          [headingLevel]="2"
        />
      } @else if (rows().length === 0) {
        <ui-empty-state
          heading="Nothing matches those filters"
          message="No expense matches that search and status together. Widen the status, or try a
                   different merchant or amount."
          [headingLevel]="2"
        >
          <button uiButton uiEmptyAction variant="secondary" (click)="clearFilters()">
            Clear filters
          </button>
        </ui-empty-state>
      } @else {
        <p class="mb-3 text-sm text-muted" aria-live="polite">{{ resultSummary() }}</p>

        <!-- Desktop: a real table, so headers, sort state and row/column
             relationships are all native. -->
        <div class="hidden overflow-hidden rounded-xl border border-line md:block">
          <table class="w-full border-collapse text-sm">
            <caption class="sr-only">
              Expenses, sortable by date and amount.
            </caption>
            <thead class="bg-surface">
              <tr class="text-xs font-medium tracking-wide text-muted uppercase">
                <th scope="col" class="p-0 text-left" [attr.aria-sort]="dateSort()">
                  <button
                    type="button"
                    class="flex w-full items-center gap-1 px-4 py-3 text-left
                           transition-colors duration-150 ease-out hover:text-body
                           focus-visible:outline-2 focus-visible:-outline-offset-2
                           focus-visible:outline-brand-teal"
                    (click)="toggleSort('date')"
                  >
                    Date
                    <span aria-hidden="true">{{ sortArrow('date') }}</span>
                  </button>
                </th>
                <th scope="col" class="px-4 py-3 text-left">Merchant</th>
                <th scope="col" class="px-4 py-3 text-left">Status</th>
                <th scope="col" class="p-0 text-right" [attr.aria-sort]="amountSort()">
                  <button
                    type="button"
                    class="flex w-full items-center justify-end gap-1 px-4 py-3 text-right
                           transition-colors duration-150 ease-out hover:text-body
                           focus-visible:outline-2 focus-visible:-outline-offset-2
                           focus-visible:outline-brand-teal"
                    (click)="toggleSort('amount')"
                  >
                    Amount
                    <span aria-hidden="true">{{ sortArrow('amount') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              @for (row of rows(); track row.id) {
                <tr class="transition-colors duration-150 ease-out hover:bg-surface">
                  <td class="tabular px-4 py-3 whitespace-nowrap text-muted">
                    {{ formatDate(row.expenseDate) }}
                  </td>
                  <td class="px-4 py-3">
                    <span class="font-medium text-body">{{ row.merchant || 'Untitled' }}</span>
                    @if (row.note) {
                      <span class="block text-xs text-muted">{{ row.note }}</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <ui-badge [status]="row.status" />
                  </td>
                  <td
                    class="tabular px-4 py-3 text-right font-medium whitespace-nowrap text-body"
                    data-money
                  >
                    {{ amountText(row) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Phone: stacked cards, never a sideways scroll (§3.1). -->
        <ul class="space-y-3 md:hidden">
          @for (row of rows(); track row.id) {
            <li class="rounded-xl border border-line bg-card p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate font-medium text-body">{{ row.merchant || 'Untitled' }}</p>
                  <p class="tabular mt-0.5 text-xs text-muted">
                    {{ formatDate(row.expenseDate) }}
                  </p>
                </div>
                <span class="tabular shrink-0 font-medium text-body" data-money>
                  {{ amountText(row) }}
                </span>
              </div>

              @if (row.note) {
                <p class="mt-2 text-sm text-muted">{{ row.note }}</p>
              }

              <div class="mt-3">
                <ui-badge [status]="row.status" />
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class Expenses {
  private readonly api = inject(ApiClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly formatDate = formatDate;

  // --- table state ---------------------------------------------------------

  readonly text = signal(DEFAULT_FILTER.text);
  readonly status = signal<StatusFilter>(DEFAULT_FILTER.status);
  readonly sort = signal(DEFAULT_SORT);

  private readonly filter = computed(() => ({ text: this.text(), status: this.status() }));

  protected readonly filtering = computed(() => isFiltering(this.filter()));

  // --- data ----------------------------------------------------------------

  /**
   * `undefined` params on the server park the resource in `idle` and skip the
   * loader: `ApiClient` refuses to run during SSR, and baking an error state
   * into the SSR payload would flash a false failure before hydration.
   */
  readonly data = resource<Page<Expense>, { limit: number } | undefined>({
    params: () => (this.isBrowser ? { limit: FETCH_LIMIT } : undefined),
    loader: ({ params, abortSignal }) =>
      this.api.get<Page<Expense>>('/expenses/search', { limit: params.limit }, abortSignal),
  });

  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));

  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly pending = computed(() => !this.data.hasValue() && !this.failed());

  protected readonly errorDetail = computed(() => {
    const error = this.data.error();
    return error instanceof Error ? error.message : null;
  });

  private readonly expenses = computed(() => this.loaded()?.items ?? []);

  protected readonly noExpensesAtAll = computed(() => this.expenses().length === 0);

  /** The rows actually rendered — filtered, then sorted. */
  readonly rows = computed(() => applyTableState(this.expenses(), this.filter(), this.sort()));

  // --- copy ----------------------------------------------------------------

  protected readonly subtitle = computed(() => {
    if (this.pending()) return 'Fetching your expenses…';
    const total = this.expenses().length;
    return total === 1 ? '1 expense on file.' : `${total} expenses on file.`;
  });

  protected readonly resultSummary = computed(() => {
    const shown = this.rows().length;
    const total = this.expenses().length;
    if (!this.filtering()) return `Showing all ${total}.`;
    return `Showing ${shown} of ${total}.`;
  });

  // --- sorting -------------------------------------------------------------

  protected readonly dateSort = computed(() => ariaSort(this.sort(), 'date'));
  protected readonly amountSort = computed(() => ariaSort(this.sort(), 'amount'));

  protected toggleSort(key: SortKey): void {
    this.sort.update((current) => nextSort(current, key));
  }

  /** Direction is shown as shape as well as `aria-sort`, never colour alone. */
  protected sortArrow(key: SortKey): string {
    const sort = this.sort();
    if (sort.key !== key) return '↕';
    return sort.direction === 'asc' ? '↑' : '↓';
  }

  // --- events --------------------------------------------------------------

  protected onStatusChange(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as StatusFilter);
  }

  protected clearFilters(): void {
    this.text.set(DEFAULT_FILTER.text);
    this.status.set(DEFAULT_FILTER.status);
  }

  protected amountText(expense: Expense): string {
    return formatMoney(expenseAmount(expense), expense.baseCurrency || expense.currency);
  }

  reload(): void {
    this.data.reload();
  }
}
