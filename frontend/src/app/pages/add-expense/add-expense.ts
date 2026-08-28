import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CURRENCIES, type Expense } from '@actuo/shared';
import { ApiClient } from '../../core/api/api-client.js';

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

  protected readonly currencies = CURRENCIES;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly saving = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly failed = signal(false);

  protected onSubmit(event: Event): void {
    event.preventDefault();

    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const payload = {
      amount: Number(data.get('amount')),
      currency: String(data.get('currency') ?? 'INR'),
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
