import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CURRENCIES, SUBMIT_EXPENSE, type Category, type Expense } from '@actuo/shared';
import { ApiClient } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { ToolCallAudit } from '../../webmcp/tool-call-audit.js';
import { PageActions } from '../../webmcp/page-actions.js';
import {
  AGENT_FILL_STAGGER_MS,
  agentPause,
  setFieldValue,
} from '../../core/agent/fill-pacing.js';

/**
 * Add Expense — the DECLARATIVE WebMCP surface (PRD §7).
 *
 * Every other tool in Actuo is registered imperatively through `ToolRegistry`.
 * This one is deliberately different: the form below is annotated plain HTML,
 * and the browser derives a tool from it with **no `registerTool()` call
 * anywhere**. That contrast is the point of the demo, so resist the urge to
 * "improve" this by registering it in TypeScript — doing so would delete the
 * capability being demonstrated.
 *
 * How the annotations work:
 *   toolname / tooldescription      on the <form>  — declare the tool
 *   toolparamdescription            on each control — describe the parameter
 *   toolautosubmit                  submit without waiting for a human click
 *
 * When an agent invokes it the browser fills the fields and submits, and the
 * SubmitEvent carries `agentInvoked` plus `respondWith()` so the page can hand
 * a structured result back rather than just navigating.
 *
 * Design Doc §3.3 asks this screen to stay visually plain, reinforcing that it
 * is "just a form".
 */
@Component({
  selector: 'app-add-expense',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="mx-auto max-w-lg p-4">
      <h1 class="mb-1 font-display text-2xl">Add an expense</h1>
      <p class="mb-6 text-sm text-muted">
        A plain HTML form. An AI agent can fill and submit it without any JavaScript
        tool registration — the annotations below are the whole integration.
      </p>

      <form
        #form
        toolname="add_expense_form"
        tooldescription="Record a new expense from a merchant, amount and date."
        toolautosubmit
        class="space-y-4"
        (submit)="onSubmit($event)"
      >
        <div>
          <label class="mb-1 block text-sm font-medium" for="amount">Amount</label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            toolparamdescription="How much was spent, as a positive number."
            class="tabular min-h-11 w-full rounded-md border border-line bg-card px-3 text-body"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="currency">Currency</label>
          <select
            id="currency"
            name="currency"
            required
            toolparamdescription="Three-letter currency code, for example INR."
            class="min-h-11 w-full rounded-md border border-line bg-card px-3 text-body"
          >
            @for (code of currencies; track code) {
              <option [value]="code">{{ code }}</option>
            }
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="merchant">Merchant</label>
          <input
            id="merchant"
            name="merchant"
            type="text"
            toolparamdescription="Where the money was spent, for example Barista."
            class="min-h-11 w-full rounded-md border border-line bg-card px-3 text-body"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="categoryId">Category</label>
          <select
            id="categoryId"
            name="categoryId"
            toolparamdescription="Category UUID. Call fetch_categories first to see valid options."
            class="min-h-11 w-full rounded-md border border-line bg-card px-3 text-body"
          >
            <option value="">None</option>
            @for (cat of categories(); track cat.id) {
              <option [value]="cat.id">{{ cat.name }}</option>
            }
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="expenseDate">Date</label>
          <input
            id="expenseDate"
            name="expenseDate"
            type="date"
            required
            [value]="today"
            toolparamdescription="The date of the expense, as YYYY-MM-DD."
            class="min-h-11 w-full rounded-md border border-line bg-card px-3 text-body"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="note">Note</label>
          <textarea
            id="note"
            name="note"
            rows="2"
            toolparamdescription="Optional free-text note about the expense."
            class="w-full rounded-md border border-line bg-card px-3 py-2 text-body"
          ></textarea>
        </div>

        <button
          type="submit"
          class="min-h-11 w-full rounded-md bg-brand-teal px-4 font-medium text-ink-inverted disabled:opacity-50"
          [disabled]="saving()"
        >
          {{ saving() ? 'Saving…' : 'Save expense' }}
        </button>
      </form>

      @if (message(); as text) {
        <p
          class="mt-4 rounded-md border border-line bg-card p-3 text-sm"
          [class.text-status-danger]="failed()"
          [class.text-status-success]="!failed()"
          role="status"
        >
          {{ text }}
        </p>
      }
    </section>
  `,
})
export class AddExpense {
  private readonly api = inject(ApiClient);
  private readonly session = inject(Session);
  private readonly audit = inject(ToolCallAudit);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly currencies = CURRENCIES;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly saving = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly categories = signal<Category[]>([]);

  private readonly pages = inject(PageActions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formRef = viewChild<ElementRef<HTMLFormElement>>('form');

  /** Overridden to 0 in tests, which have no interest in watching it type. */
  protected fillStaggerMs = AGENT_FILL_STAGGER_MS;

  constructor() {
    if (this.isBrowser) void this.loadCategories();

    /*
     * This page owns `submit_expense`. The tool navigates here and hands the
     * work over rather than posting on its own, so the user sees the same form
     * they would have filled themselves being filled.
     */
    this.destroyRef.onDestroy(
      this.pages.provide(SUBMIT_EXPENSE.name, (args: SubmitArgs, { signal }) =>
        this.fillAndSubmit(args, signal),
      ),
    );
  }

  /**
   * Fill the visible form, then save and submit for approval.
   *
   * **Deliberately not `form.requestSubmit()`.** `onSubmit` writes the audit
   * row as `actor: submitEvent.agentInvoked ? 'agent' : 'human'`, and a
   * synthetic submit carries no `agentInvoked` — so going through it would file
   * the agent's work as a *human* action. That flag is the only thing in the
   * app that can produce `actor: 'human'`, and the audit viewer's human/agent
   * contrast is built on it. `ToolRegistry.log()` already records this call as
   * `submit_expense`, so the save path is called directly instead.
   */
  private async fillAndSubmit(args: SubmitArgs, signal: AbortSignal): Promise<unknown> {
    const form = this.formRef()?.nativeElement;
    if (!form) throw new Error('The Add expense form is not on screen.');

    const expenseDate = args.expenseDate ?? this.today;
    const values: readonly [string, string | undefined][] = [
      ['amount', args.amount === undefined ? undefined : String(args.amount)],
      ['currency', args.currency],
      ['merchant', args.merchant],
      ['categoryId', args.categoryId],
      ['expenseDate', expenseDate],
      ['note', args.note],
    ];

    for (const [name, value] of values) {
      if (value === undefined || value === '') continue;
      signal.throwIfAborted();
      setFieldValue(form, name, value);
      await agentPause(this.fillStaggerMs, signal);
    }

    signal.throwIfAborted();

    const created = (await this.save(
      {
        amount: args.amount,
        currency: args.currency,
        categoryId: args.categoryId || null,
        merchant: args.merchant || null,
        note: args.note || null,
        expenseDate,
      },
      form,
    )) as { id: string };

    /*
     * `submit_expense` means create *and* send for approval — two POSTs, which
     * is what it has always done. The form on its own only creates a draft, so
     * the transition happens here rather than silently changing the contract.
     */
    const submitted = await this.api.post<Expense>(`/expenses/${created.id}/submit`, undefined);
    this.message.set(
      `Submitted ${submitted.currency} ${submitted.amount}` +
        `${submitted.merchant ? ` at ${submitted.merchant}` : ''} for approval.`,
    );
    void this.session.refreshPendingApprovals();

    return {
      id: submitted.id,
      amount: submitted.amount,
      currency: submitted.currency,
      merchant: submitted.merchant,
      status: submitted.status,
      date: submitted.expenseDate,
    };
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(
        await this.api.get<Category[]>('/orgs/current/categories'),
      );
    } catch {
      // The form still works without categories — the field stays empty.
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const payload = {
      amount: Number(data.get('amount')),
      currency: String(data.get('currency') ?? 'INR'),
      categoryId: (data.get('categoryId') as string) || null,
      merchant: (data.get('merchant') as string) || null,
      note: (data.get('note') as string) || null,
      expenseDate: String(data.get('expenseDate') ?? this.today),
    };

    const save = this.save(payload, form);

    /*
     * An agent-invoked submit gets a structured result instead of a page
     * navigation. `respondWith` is what closes the loop back to the agent, and
     * `agentInvoked` is how we tell the two callers apart. Both are additions
     * to SubmitEvent from the declarative WebMCP proposal, so they are read
     * defensively — a browser without the feature simply takes the human path.
     */
    const submitEvent = event as SubmitEvent & {
      agentInvoked?: boolean;
      respondWith?: (result: Promise<unknown>) => void;
    };

    if (submitEvent.agentInvoked && typeof submitEvent.respondWith === 'function') {
      submitEvent.respondWith(save);
    }

    /*
     * This form is the ONLY tool call that can come from a person, because it
     * is the only one the browser derives from markup rather than routing
     * through `ToolRegistry` — and `agentInvoked` is what tells the two apart.
     * Everything else in `tool_call_log` is an agent, so without this row the
     * audit viewer's "Human" filter is permanently empty and the human/agent
     * contrast it exists to draw has nothing to draw it with.
     */
    void save
      .then((result) => {
        this.audit.record({
          actor: submitEvent.agentInvoked ? 'agent' : 'human',
          toolName: 'add_expense_form',
          input: payload,
          output: result,
        });
        // A new expense can be submitted for approval, which changes what the
        // state-gated `approve_expense` tool should be offering.
        return this.session.refreshPendingApprovals();
      })
      .catch(() => undefined);

    /*
     * The failure is already surfaced in `message()`, so this catch exists only
     * to keep a rejected promise from going unhandled. Without it the human
     * path raises an unhandledrejection on every failed save, since nothing
     * else is awaiting `save`.
     *
     * Attached unconditionally: `respondWith` consumes the same promise, and a
     * second handler does not interfere with its result.
     */
    save.catch(() => undefined);
  }

  private async save(payload: Record<string, unknown>, form: HTMLFormElement): Promise<unknown> {
    this.saving.set(true);
    this.message.set(null);

    try {
      const expense = await this.api.post<Expense>('/expenses', payload);
      this.failed.set(false);
      this.message.set(
        `Saved ${expense.currency} ${expense.amount}${expense.merchant ? ` at ${expense.merchant}` : ''}.`,
      );
      form.reset();
      return { id: expense.id, status: expense.status, amount: expense.amount };
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Could not save the expense.';
      this.failed.set(true);
      this.message.set(text);
      // Rethrow so respondWith() reports the failure to the agent too.
      throw error;
    } finally {
      this.saving.set(false);
    }
  }
}

type SubmitArgs = {
  amount: number;
  currency: string;
  merchant?: string;
  categoryId?: string;
  note?: string;
  expenseDate?: string;
};
