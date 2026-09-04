import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { APPROVE_EXPENSE, SET_BUDGET, SUBMIT_EXPENSE } from '@actuo/shared';
import { Copilot } from '../copilot/copilot.js';
import { PageActions } from '../webmcp/page-actions.js';
import type { ActuoTool } from '../webmcp/tool-registry.js';

/** Which page owns each action. The tool goes there before asking for it. */
const OWNER_PAGE: Readonly<Record<string, string>> = {
  [SUBMIT_EXPENSE.name]: '/add',
  [APPROVE_EXPENSE.name]: '/expenses',
  [SET_BUDGET.name]: '/budgets',
};

/**
 * The tools that change something, and therefore have to be seen changing it.
 *
 * Every one of these used to POST straight to `/api/*`, which gave the agent a
 * back door no person has: the work happened, the screen did not move, and the
 * user was left looking at figures that were quietly out of date. A human
 * cannot add an expense without going to the Add expense page, or change a
 * budget without going to the Budgets page. Neither can an agent now.
 *
 * Each `execute` is the same three steps — go to the page, wait for it to
 * mount, hand it the work — and the page performs the action through the exact
 * path its own buttons use. That is what makes the optimistic row patching, the
 * form messages and the reloads apply with no new plumbing, and it is why
 * **this service injects no `ApiClient`**: there is no way for it to reach the
 * API behind the page's back, which is the property `page-driven-tools.spec.ts`
 * asserts directly.
 *
 * Kept apart from `ExpenseTools` for the same reason `navigation-tools.ts` is:
 * the reads test cleanly against a fake `ApiClient` with no router and no DOM,
 * and these test cleanly against a fake router with no HTTP at all.
 */
@Injectable({ providedIn: 'root' })
export class PageDrivenTools {
  private readonly router = inject(Router);
  private readonly pages = inject(PageActions);
  private readonly copilot = inject(Copilot);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Create an expense and submit it for approval, on the Add expense page. */
  submitExpense(): ActuoTool<{
    amount: number;
    currency: string;
    merchant?: string;
    categoryId?: string;
    note?: string;
    expenseDate?: string;
  }> {
    return { contract: SUBMIT_EXPENSE, execute: this.onOwnerPage(SUBMIT_EXPENSE.name) };
  }

  /** Approve or reject a row, on the Expenses page. */
  approveExpense(): ActuoTool<{ expenseId: string; decision: string; comment?: string }> {
    return { contract: APPROVE_EXPENSE, execute: this.onOwnerPage(APPROVE_EXPENSE.name) };
  }

  /** Create or update a budget, on the Budgets page. */
  setBudget(): ActuoTool<{ categoryId?: string; amount: number; rollover?: boolean }> {
    return { contract: SET_BUDGET, execute: this.onOwnerPage(SET_BUDGET.name) };
  }

  /** The always-on ones. `approve_expense` is state-gated by `ToolSession`. */
  all(): ActuoTool<never>[] {
    return [this.submitExpense(), this.setBudget()] as unknown as ActuoTool<never>[];
  }

  /**
   * Navigate to the page that owns `action`, then run it there.
   *
   * The navigation is not checked for success: the handler wait is the real
   * test, and it reports a page that never arrived in words a model can pass
   * on. A guard redirect and a slow chunk both land in the same place.
   */
  private onOwnerPage<TArgs extends Record<string, unknown>>(
    action: string,
  ): (args: TArgs, context: { signal: AbortSignal }) => Promise<unknown> {
    return async (args, { signal }) => {
      if (!this.isBrowser) {
        throw new Error('This action needs the app open in a browser.');
      }

      // Below `sm` the Copilot covers the whole screen; drop it to the orb so
      // the user can actually watch what happens next.
      this.copilot.collapseForPageAction();

      await this.router.navigateByUrl(OWNER_PAGE[action] ?? '/dashboard');
      const run = await this.pages.awaitHandler(action, signal);
      return run(args as never, { signal });
    };
  }
}
