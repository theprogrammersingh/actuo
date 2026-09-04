import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { APPROVE_EXPENSE, EXPENSE_PAGE_MAX } from '@actuo/shared';
import type { Expense, Page, TransitionAction } from '@actuo/shared';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton } from '../../ui';
import { formatDate, formatMoney, formatRate } from '../../core/format/money.js';
import { expenseAmount, expenseCurrency, isConverted } from '../../core/expense/amount.js';
import { CurrencyConverter } from '../../converter/currency-converter.js';
import { ConverterSession } from '../../converter/converter-session.js';
import { Session } from '../../core/session/session.js';
import { PageActions } from '../../webmcp/page-actions.js';
import {
  ACTION_LABEL,
  actionPath,
  availableActions,
  describeAction,
  mayEdit,
  takesComment,
} from '../../core/expense/expense-actions.js';
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
 * One page. Filtering and sorting happen in the browser (`expense-filter.ts`)
 * over everything loaded so far, and `Load more` fetches the next page.
 *
 * This asked for 200 before, which the API rejects outright with a 400 — its
 * cap is EXPENSE_PAGE_MAX. Guessing the server's limit is what broke the page;
 * reading it from the shared contract is what stops it happening again.
 */
const PAGE_SIZE = EXPENSE_PAGE_MAX;

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
  imports: [Badge, Button, CurrencyConverter, EmptyState, ErrorState, Input, Skeleton],
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
                <th scope="col" class="px-4 py-3 text-right">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              @for (row of rows(); track row.id) {
                <!-- The id is what an agent-driven decision scrolls to. -->
                <tr
                  [attr.data-expense-row]="row.id"
                  class="transition-colors duration-150 ease-out hover:bg-surface"
                >
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
                  <!-- The tabular class sits on the cell, not the spans: it
                       inherits, so the figure and the rate line beneath it both
                       get the tabular numerals §2.3 requires for money. -->
                  <td class="tabular px-4 py-3 text-right whitespace-nowrap" data-money>
                    <span class="font-medium text-body">{{ amountText(row) }}</span>
                    @if (lockedRateText(row); as locked) {
                      <span class="mt-0.5 block text-xs font-normal text-muted">{{ locked }}</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-right align-top">
                <!--
                  Only the actions the server would accept, from the same tables
                  it enforces with (see availableActions). A button that is
                  certain to 403 is worse than no button.
                -->
                <div class="flex flex-wrap items-center justify-end gap-1.5">
                  @for (action of actionsFor(row); track action) {
                    <button
                      uiButton
                      type="button"
                      size="sm"
                      [variant]="action === 'reject' ? 'danger' : 'secondary'"
                      [loading]="busyRow() === row.id"
                      (click)="onAction(row, action)"
                    >
                      {{ actionLabel[action] }}
                    </button>
                  }
                  @if (canDelete(row)) {
                    <button
                      uiButton
                      type="button"
                      size="sm"
                      [variant]="armedDelete() === row.id ? 'danger' : 'ghost'"
                      [loading]="busyRow() === row.id"
                      (click)="onDelete(row)"
                      (blur)="disarmDelete()"
                    >
                      {{ armedDelete() === row.id ? 'Confirm delete' : 'Delete' }}
                    </button>
                  }
                </div>

                <!-- The decision comment: optional, and inline so the row keeps context. -->
                @for (action of actionsFor(row); track action) {
                  @if (takesComment(action) && isCommenting(row.id, action)) {
                    <div class="mt-2 rounded-lg border border-line bg-surface p-3 text-left">
                      <label
                        [attr.for]="'comment-' + row.id"
                        class="mb-1.5 block text-xs font-medium text-body"
                      >
                        Add a note (optional)
                      </label>
                      <textarea
                        [id]="'comment-' + row.id"
                        rows="2"
                        class="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm
                               text-body focus-visible:outline-2 focus-visible:-outline-offset-1
                               focus-visible:outline-brand-teal"
                        [value]="comment()"
                        (input)="comment.set($any($event.target).value)"
                      ></textarea>
                      <div class="mt-2 flex justify-end gap-2">
                        <button uiButton type="button" size="sm" variant="ghost" (click)="cancelComment()">
                          Cancel
                        </button>
                        <button
                          uiButton
                          type="button"
                          size="sm"
                          [variant]="action === 'reject' ? 'danger' : 'primary'"
                          [loading]="busyRow() === row.id"
                          (click)="onAction(row, action)"
                        >
                          {{ actionLabel[action] }}
                        </button>
                      </div>
                    </div>
                  }
                }

                @if (errorFor(row.id); as message) {
                  <p class="mt-2 text-left text-xs text-status-danger" role="status">{{ message }}</p>
                }

                @if (canConvert(row)) {
                  <div class="mt-2 text-left">
                    <button
                      type="button"
                      class="text-xs text-muted underline decoration-line underline-offset-2 hover:text-body"
                      [attr.aria-expanded]="converter.isOpen(converterSurface(row.id))"
                      (click)="converter.toggle(converterSurface(row.id))"
                    >
                      {{
                        converter.isOpen(converterSurface(row.id))
                          ? 'Hide the rate lookup'
                          : 'What is this in ' + baseCurrencyOf(row) + '?'
                      }}
                    </button>
                  </div>
                }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Phone: stacked cards, never a sideways scroll (§3.1). -->
        <ul class="space-y-3 md:hidden">
          @for (row of rows(); track row.id) {
            <li [attr.data-expense-row]="row.id" class="rounded-xl border border-line bg-card p-4">
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

              <!-- Full width, below the header row rather than tucked under the
                   amount: at 390px the rate line is ~246px, and inside the
                   right-aligned block it left the merchant name 67px to
                   truncate into. -->
              @if (lockedRateText(row); as locked) {
                <p class="tabular mt-1 text-xs text-muted">{{ locked }}</p>
              }

              @if (row.note) {
                <p class="mt-2 text-sm text-muted">{{ row.note }}</p>
              }

              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <ui-badge [status]="row.status" />
              </div>

                <!--
                  Only the actions the server would accept, from the same tables
                  it enforces with (see availableActions). A button that is
                  certain to 403 is worse than no button.
                -->
                <div class="flex flex-wrap items-center justify-end gap-1.5">
                  @for (action of actionsFor(row); track action) {
                    <button
                      uiButton
                      type="button"
                      size="sm"
                      [variant]="action === 'reject' ? 'danger' : 'secondary'"
                      [loading]="busyRow() === row.id"
                      (click)="onAction(row, action)"
                    >
                      {{ actionLabel[action] }}
                    </button>
                  }
                  @if (canDelete(row)) {
                    <button
                      uiButton
                      type="button"
                      size="sm"
                      [variant]="armedDelete() === row.id ? 'danger' : 'ghost'"
                      [loading]="busyRow() === row.id"
                      (click)="onDelete(row)"
                      (blur)="disarmDelete()"
                    >
                      {{ armedDelete() === row.id ? 'Confirm delete' : 'Delete' }}
                    </button>
                  }
                </div>

                <!-- The decision comment: optional, and inline so the row keeps context. -->
                @for (action of actionsFor(row); track action) {
                  @if (takesComment(action) && isCommenting(row.id, action)) {
                    <div class="mt-2 rounded-lg border border-line bg-surface p-3 text-left">
                      <label
                        [attr.for]="'comment-' + row.id"
                        class="mb-1.5 block text-xs font-medium text-body"
                      >
                        Add a note (optional)
                      </label>
                      <textarea
                        [id]="'comment-' + row.id"
                        rows="2"
                        class="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm
                               text-body focus-visible:outline-2 focus-visible:-outline-offset-1
                               focus-visible:outline-brand-teal"
                        [value]="comment()"
                        (input)="comment.set($any($event.target).value)"
                      ></textarea>
                      <div class="mt-2 flex justify-end gap-2">
                        <button uiButton type="button" size="sm" variant="ghost" (click)="cancelComment()">
                          Cancel
                        </button>
                        <button
                          uiButton
                          type="button"
                          size="sm"
                          [variant]="action === 'reject' ? 'danger' : 'primary'"
                          [loading]="busyRow() === row.id"
                          (click)="onAction(row, action)"
                        >
                          {{ actionLabel[action] }}
                        </button>
                      </div>
                    </div>
                  }
                }

                @if (errorFor(row.id); as message) {
                  <p class="mt-2 text-left text-xs text-status-danger" role="status">{{ message }}</p>
                }

                @if (canConvert(row)) {
                  <div class="mt-2 text-left">
                    <button
                      type="button"
                      class="text-xs text-muted underline decoration-line underline-offset-2 hover:text-body"
                      [attr.aria-expanded]="converter.isOpen(converterSurface(row.id))"
                      (click)="converter.toggle(converterSurface(row.id))"
                    >
                      {{
                        converter.isOpen(converterSurface(row.id))
                          ? 'Hide the rate lookup'
                          : 'What is this in ' + baseCurrencyOf(row) + '?'
                      }}
                    </button>
                  </div>
                }
            </li>
          }
        </ul>
      }

      <!--
        ONE converter for the page, not one per row.

        Both layouts above are in the DOM at all times — the table is hidden
        below the md breakpoint and the card list above it, so CSS decides which
        but both render. A panel inside the row markup therefore mounted TWICE
        for a single open row: two iframes, two loads of a whole separate app,
        and two windows publishing the same WebMCP tool names. Rendering it once
        here, driven by whichever row is open, is what keeps the one-frame rule
        ConverterSession enforces everywhere else.
      -->
      @if (openConverterFor(); as openRow) {
        <div class="mt-4 rounded-lg border border-line bg-surface p-3">
          <p class="mb-2 text-xs text-muted">
            Rate lookup for
            <span class="text-body">{{ openRow.merchant || 'this expense' }}</span> —
            {{ amountText(openRow) }} filed in {{ openRow.currency }}. This does not change what
            the expense is recorded as.
          </p>
          <app-currency-converter
            [surface]="converterSurface(openRow.id)"
            [title]="'Currency converter for ' + (openRow.merchant || 'this expense')"
          />
        </div>
      }

      <!--
        Only rendered when the server says there are more rows. Without the
        count this would be a button that might do nothing, which is exactly
        the kind of quiet dishonesty the old fixed limit produced.
      -->
      @if (hasMore()) {
        <div class="mt-6 flex flex-col items-center gap-2">
          <button
            uiButton
            variant="secondary"
            type="button"
            [loading]="loadingMore()"
            (click)="loadMore()"
          >
            Load {{ remaining() < 100 ? remaining() : 100 }} more
          </button>
          <p class="text-xs text-muted" aria-live="polite">
            Showing {{ loadedCount() }} of {{ totalAvailable() }}.
          </p>
        </div>
      }

      @if (loadMoreError(); as message) {
        <p class="mt-3 text-center text-sm text-status-danger" role="status">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class Expenses {
  private readonly api = inject(ApiClient);
  private readonly session = inject(Session);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly formatDate = formatDate;
  protected readonly actionLabel = ACTION_LABEL;
  protected readonly takesComment = takesComment;

  // --- workflow actions ----------------------------------------------------

  /**
   * Rows changed since the last fetch, keyed by id.
   *
   * An action patches the row here rather than reloading the page. Reloading
   * after approving one of forty rows would discard every `Load more` page and
   * the scroll position, which is a worse outcome than a slightly stale total.
   */
  private readonly patched = signal<Readonly<Record<string, Expense>>>({});

  /** Which row has its comment panel open, and for which decision. */
  protected readonly openAction = signal<{ id: string; action: TransitionAction } | null>(null);
  protected readonly comment = signal('');
  /** Row id whose Delete has been armed — the second click confirms. */
  protected readonly armedDelete = signal<string | null>(null);

  /** Owns the single converter frame across every surface. */
  protected readonly converter = inject(ConverterSession);

  private readonly pages = inject(PageActions);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    /*
     * Resolve the converter's config up front. The rate-lookup trigger is gated
     * on `isAvailable()`, and the frame that would otherwise load that config
     * only mounts once the trigger is shown — so without this the gate could
     * never open. The session caches it, so this is one request per session
     * however many surfaces ask.
     */
    void this.converter.ensureConfig();

    /*
     * This page owns `approve_expense`. The tool navigates here and hands the
     * decision over, so it runs through `run()` — the same path the row's own
     * buttons use, which patches the visible row rather than reloading.
     */
    this.destroyRef.onDestroy(
      this.pages.provide(APPROVE_EXPENSE.name, (args: DecisionArgs, { signal }) =>
        this.decideFromAgent(args, signal),
      ),
    );
  }

  /**
   * Approve or reject on behalf of an agent, through the visible row.
   *
   * Deliberately no `data.reload()`: `run()` patches the row in place, and a
   * reload would discard every `Load more` page and the scroll position for the
   * same reason the button path avoids it.
   */
  private async decideFromAgent(args: DecisionArgs, signal: AbortSignal): Promise<unknown> {
    const action: TransitionAction = args.decision === 'approved' ? 'approve' : 'reject';

    /*
     * The row is usually already on screen, but an agent can name an expense
     * from a search that reaches past the loaded page. Fetching the one row is
     * cheaper and less disruptive than paging until it turns up.
     */
    const target =
      this.rows().find((row) => row.id === args.expenseId) ??
      (await this.api.get<Expense>(`/expenses/${args.expenseId}`, undefined, signal));

    this.scrollRowIntoView(target.id);
    await this.run(target, action, args.comment ?? '');

    const rowError = this.rowError();
    if (rowError?.id === target.id) throw new Error(rowError.message);

    const updated = this.patched()[target.id] ?? target;
    return {
      id: updated.id,
      amount: updated.amount,
      currency: updated.currency,
      merchant: updated.merchant,
      status: updated.status,
      date: updated.expenseDate,
    };
  }

  /**
   * Put the row the agent is about to act on where the user can see it.
   *
   * Feature-detected rather than assumed: scrolling is a courtesy, and a
   * decision must not fail because a row is off screen or because the host has
   * no layout to scroll (the test environment, and prerendering).
   */
  private scrollRowIntoView(id: string): void {
    if (!this.isBrowser) return;
    const row = document.querySelector(`[data-expense-row="${id}"]`);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** Row id with an action in flight, so its buttons can show a busy state. */
  protected readonly busyRow = signal<string | null>(null);
  protected readonly rowError = signal<{ id: string; message: string } | null>(null);

  private readonly actor = computed(() => ({
    role: this.session.role(),
    userId: this.session.user()?.id ?? null,
  }));

  protected actionsFor(expense: Expense): TransitionAction[] {
    return availableActions(expense, this.actor());
  }

  protected canDelete(expense: Expense): boolean {
    return mayEdit(expense, this.actor());
  }

  protected errorFor(id: string): string | null {
    const error = this.rowError();
    return error?.id === id ? error.message : null;
  }

  protected isCommenting(id: string, action: TransitionAction): boolean {
    const open = this.openAction();
    return open?.id === id && open.action === action;
  }

  /**
   * A decision opens an inline comment panel; everything else runs straight
   * away. Deliberately not a modal — there is no Dialog in the design system,
   * and a full-screen overlay to type one optional sentence is heavier than the
   * decision deserves.
   */
  protected onAction(expense: Expense, action: TransitionAction): void {
    this.rowError.set(null);
    if (takesComment(action) && !this.isCommenting(expense.id, action)) {
      this.comment.set('');
      this.openAction.set({ id: expense.id, action });
      return;
    }
    void this.run(expense, action, takesComment(action) ? this.comment().trim() : '');
  }

  protected cancelComment(): void {
    this.openAction.set(null);
    this.comment.set('');
  }

  /** Two-step, in place: the first click arms, the second deletes. */
  protected onDelete(expense: Expense): void {
    this.rowError.set(null);
    if (this.armedDelete() !== expense.id) {
      this.armedDelete.set(expense.id);
      return;
    }
    void this.remove(expense);
  }

  protected disarmDelete(): void {
    this.armedDelete.set(null);
  }

  private async run(expense: Expense, action: TransitionAction, comment: string): Promise<void> {
    this.busyRow.set(expense.id);
    try {
      const updated = await this.api.post<Expense>(
        actionPath(expense.id, action),
        comment ? { comment } : {},
      );
      this.patched.update((rows) => ({ ...rows, [updated.id]: updated }));
      this.openAction.set(null);
      this.comment.set('');
      // A decision changes the approval queue, which is what gates the
      // `approve_expense` WebMCP tool.
      void this.session.refreshPendingApprovals();
    } catch (error) {
      this.rowError.set({ id: expense.id, message: describeFailure(error, action) });
    } finally {
      this.busyRow.set(null);
    }
  }

  private async remove(expense: Expense): Promise<void> {
    this.busyRow.set(expense.id);
    try {
      await this.api.delete(`/expenses/${expense.id}`);
      this.patched.update((rows) => ({
        ...rows,
        [expense.id]: { ...expense, deletedAt: new Date().toISOString() },
      }));
      this.armedDelete.set(null);
      void this.session.refreshPendingApprovals();
    } catch (error) {
      this.rowError.set({ id: expense.id, message: describeFailure(error, 'delete') });
    } finally {
      this.busyRow.set(null);
    }
  }

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
    params: () => (this.isBrowser ? { limit: PAGE_SIZE } : undefined),
    loader: ({ params, abortSignal }) =>
      this.api.get<Page<Expense>>(
        '/expenses/search',
        { limit: params.limit, offset: 0 },
        abortSignal,
      ),
  });

  /** Pages appended by `Load more`, kept separate so a reload discards them. */
  private readonly extraPages = signal<readonly Expense[]>([]);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));

  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly pending = computed(() => !this.data.hasValue() && !this.failed());

  protected readonly errorDetail = computed(() => {
    const error = this.data.error();
    return error instanceof Error ? error.message : null;
  });

  /**
   * Everything fetched so far — the first page plus any appended pages — with
   * locally-applied action results layered on top and soft-deleted rows dropped.
   *
   * Layering rather than refetching is what lets an approval land without
   * discarding the pages a user has already loaded.
   */
  private readonly expenses = computed(() => {
    const patched = this.patched();
    return [...(this.loaded()?.items ?? []), ...this.extraPages()]
      .map((row) => patched[row.id] ?? row)
      .filter((row) => row.deletedAt === null);
  });

  /** How many rows exist server-side, which is what makes `Load more` honest. */
  protected readonly loadedCount = computed(() => this.expenses().length);
  protected readonly totalAvailable = computed(() => this.loaded()?.total ?? 0);
  protected readonly hasMore = computed(
    () => this.expenses().length < this.totalAvailable(),
  );
  protected readonly remaining = computed(
    () => this.totalAvailable() - this.expenses().length,
  );

  /**
   * Fetch the next page and append it.
   *
   * Failures land in `loadMoreError` rather than the resource's error state:
   * losing the rows already on screen because page three failed would be a
   * worse outcome than showing a retryable message under them.
   */
  protected async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    try {
      const next = await this.api.get<Page<Expense>>('/expenses/search', {
        limit: PAGE_SIZE,
        offset: this.expenses().length,
      });
      this.extraPages.update((rows) => [...rows, ...next.items]);
    } catch (error) {
      this.loadMoreError.set(
        error instanceof Error ? error.message : 'Could not load more expenses.',
      );
    } finally {
      this.loadingMore.set(false);
    }
  }

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

  /**
   * Whether to offer a rate lookup for this row.
   *
   * Only rows in another currency: a base-currency row has nothing to convert,
   * and offering it there would be noise on most of the table. This mirrors the
   * rule the totals use — `isConverted()` is the same predicate `sumSpend()`
   * excludes on, so the trigger appears on exactly the rows the dashboard says
   * it left out.
   *
   * NOTE: the lookup is advisory. It does not, and must not, change
   * `amountText()` or anything that feeds a total — see `CurrencyConverter`.
   */
  protected canConvert(expense: Expense): boolean {
    return !isConverted(expense) && this.converter.isAvailable();
  }

  /** The org's base currency, for the trigger copy. */
  protected baseCurrencyOf(expense: Expense): string {
    return expense.baseCurrency || 'your base currency';
  }

  /** One surface id per row, so opening one row closes any other. */
  protected converterSurface(id: string): string {
    return `expense:${id}`;
  }

  /**
   * The row whose rate lookup is open, if any.
   *
   * Read back from the session rather than kept as a second copy: the session
   * is what enforces one frame at a time across every surface, and a local
   * signal here could disagree with it.
   */
  protected readonly openConverterFor = computed(() => {
    const surface = this.converter.openedSurface();
    if (!surface?.startsWith('expense:')) return null;
    const id = surface.slice('expense:'.length);
    return this.rows().find((row) => row.id === id) ?? null;
  });

  /**
   * Printed in the currency the value is actually in.
   *
   * This used to reach for `baseCurrency` first, which meant an expense filed
   * in USD — with no converted amount, because there is no FX pass yet
   * (PRD §6.5) — rendered its raw dollar figure under the org's ₹ symbol.
   */
  protected amountText(expense: Expense): string {
    return formatMoney(expenseAmount(expense), expenseCurrency(expense));
  }

  /**
   * What the figure above it was converted from, and on what rate — or null
   * when there is nothing to explain.
   *
   * This is the visible difference between the locked rate and the advisory
   * converter sitting on the same row. The converter answers "what is this
   * worth today"; this line says what the org's books actually used, on the
   * expense's own date, and it never changes afterwards.
   *
   * The date shown is `fxRateDate`, not `expenseDate`, and they legitimately
   * differ: the ECB publishes once per working day, so a Saturday expense
   * carries Friday's rate. Printing the expense's own date here would claim a
   * rate that was never published.
   */
  protected lockedRateText(expense: Expense): string | null {
    if (expense.fxRate === null || expense.fxRateDate === null) return null;
    if (expense.currency === expense.baseCurrency) return null;

    const original = formatMoney(expense.amount, expense.currency);
    const rate = formatRate(expense.fxRate);
    return `${original} · 1 ${expense.currency} = ${rate} ${expense.baseCurrency} on ${formatDate(expense.fxRateDate)}`;
  }

  reload(): void {
    this.patched.set({});
    this.rowError.set(null);
    this.data.reload();
  }
}

/**
 * Why an action failed, in copy a person can act on.
 *
 * The 409 case is the one worth spelling out: the state machine returns it when
 * the row moved under you — a double-click, or two approvers racing — and
 * "conflict" tells the user nothing about what to do next.
 */
function describeFailure(error: unknown, action: TransitionAction | 'delete'): string {
  const verb = action === 'delete' ? 'delete' : describeAction(action);
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return `Someone else changed this expense first, so it can’t be ${
        action === 'delete' ? 'deleted' : `${verb}d`
      } now. Refresh to see where it stands.`;
    }
    if (error.status === 403) return `You’re not allowed to ${verb} this expense.`;
    if (error.status === 0) {
      return `Actuo didn’t respond, so nothing was changed. Try again.`;
    }
    if (error.message) return error.message;
  }
  return `Could not ${verb} this expense. Nothing was changed.`;
}

type DecisionArgs = {
  expenseId: string;
  decision: string;
  comment?: string;
};
