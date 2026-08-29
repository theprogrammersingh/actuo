import { Injectable, inject } from '@angular/core';
import {
  GENERATE_REPORT,
  GET_BUDGET_STATUS,
  SEARCH_EXPENSES,
  SUBMIT_EXPENSE,
  APPROVE_EXPENSE,
  type BudgetStatus,
  type Expense,
  type ExpensePage,
} from '@actuo/shared';
import { ApiClient } from '../core/api/api-client.js';
import type { ActuoTool } from '../webmcp/tool-registry.js';

/**
 * The concrete WebMCP tools (PRD §7).
 *
 * Each `execute` is a plain async function over the same `/api/*` endpoints the
 * UI uses — an agent can do exactly what a human can, no more, and RBAC is
 * enforced server-side either way. Being plain functions is also what makes
 * them trivially unit-testable in isolation (PRD §9).
 */
@Injectable({ providedIn: 'root' })
export class ExpenseTools {
  private readonly api = inject(ApiClient);

  /** Read-only, so it carries `readOnlyHint` and needs no confirmation. */
  searchExpenses(): ActuoTool<{
    query?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }> {
    return {
      contract: SEARCH_EXPENSES,
      execute: async (args, { signal }) => {
        const page = await this.api.get<ExpensePage>('/expenses/search', args, signal);
        return {
          total: page.total,
          // Summarize rather than dumping rows: this text goes back to the model,
          // and full records would burn context for no benefit.
          expenses: page.items.map(summarize),
        };
      },
    };
  }

  /** Mutating — the Copilot must confirm in-chat before this runs. */
  submitExpense(): ActuoTool<{
    amount: number;
    currency: string;
    merchant?: string;
    category?: string;
    note?: string;
    expenseDate?: string;
  }> {
    return {
      contract: SUBMIT_EXPENSE,
      execute: async (args, { signal }) => {
        const expense = await this.api.post<Expense>(
          '/expenses',
          { ...args, expenseDate: args.expenseDate ?? today() },
          signal,
        );
        const submitted = await this.api.post<Expense>(
          `/expenses/${expense.id}/submit`,
          undefined,
          signal,
        );
        return summarize(submitted);
      },
    };
  }

  getBudgetStatus(): ActuoTool<{ category?: string }> {
    return {
      contract: GET_BUDGET_STATUS,
      execute: async (args, { signal }) => {
        const statuses = await this.api.get<BudgetStatus[]>('/budgets/status', args, signal);
        return statuses.map((status) => ({
          category: status.categoryName,
          budgeted: status.budgeted,
          spent: status.spent,
          remaining: status.remaining,
          utilization: `${Math.round(status.utilization * 100)}%`,
          overBudget: status.utilization > 1,
          /*
           * Passed through so the model can qualify the figure instead of
           * stating a partial total as a complete one. `spent` excludes
           * expenses filed in other currencies, because nothing converts them
           * yet (PRD §6.5) — the system prompt tells the Copilot never to
           * invent figures, and this is the field that lets it be accurate.
           */
          expensesNotCountedOtherCurrency: status.unconvertedCount,
        }));
      },
    };
  }

  /**
   * The cancellation demo (PRD §7). Report generation is polled so that an
   * abort mid-flight actually stops the work rather than merely detaching from
   * it — the UI has to reflect a real stop, not a cosmetic one.
   */
  generateReport(): ActuoTool<{ from: string; to: string; format?: 'csv' | 'pdf' }> {
    return {
      contract: GENERATE_REPORT,
      execute: async (args, { signal }) => {
        const { jobId } = await this.api.post<{ jobId: string }>('/reports/generate', args, signal);

        try {
          return await this.pollReport(jobId, signal);
        } catch (error) {
          if (signal.aborted) {
            // Tell the server to stop too, so cancellation is not just local.
            void this.api.post(`/reports/${jobId}/cancel`).catch(() => undefined);
            throw new Error('Report generation cancelled.');
          }
          throw error;
        }
      },
    };
  }

  /**
   * State-gated (PRD §7): the registry only publishes this when the signed-in
   * user is an admin/owner and something is actually pending. The server still
   * re-checks the role — the gate is UX, not security.
   */
  approveExpense(): ActuoTool<{
    expenseId: string;
    decision: 'approved' | 'rejected';
    comment?: string;
  }> {
    return {
      contract: APPROVE_EXPENSE,
      execute: async ({ expenseId, decision, comment }, { signal }) => {
        const path = decision === 'approved' ? 'approve' : 'reject';
        const expense = await this.api.post<Expense>(
          `/expenses/${expenseId}/${path}`,
          { comment },
          signal,
        );
        return summarize(expense);
      },
    };
  }

  all(): ActuoTool<never>[] {
    return [
      this.searchExpenses(),
      this.submitExpense(),
      this.getBudgetStatus(),
      this.generateReport(),
    ] as unknown as ActuoTool<never>[];
  }

  private async pollReport(jobId: string, signal: AbortSignal): Promise<unknown> {
    const deadline = Date.now() + 60_000;

    while (Date.now() < deadline) {
      signal.throwIfAborted();

      const job = await this.api.get<{ status: string; url?: string; rows?: number }>(
        `/reports/${jobId}`,
        undefined,
        signal,
      );

      if (job.status === 'ready') return { url: job.url, rows: job.rows };
      if (job.status === 'failed') throw new Error('Report generation failed.');

      await delay(500, signal);
    }

    throw new Error('Report generation timed out.');
  }
}

/** Compact, model-friendly view of an expense. */
function summarize(expense: Expense) {
  return {
    id: expense.id,
    amount: expense.amount,
    currency: expense.currency,
    merchant: expense.merchant,
    status: expense.status,
    date: expense.expenseDate,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A sleep that rejects promptly on abort, so cancellation feels instant. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true },
    );
  });
}
