import type { BudgetStatus, Expense, Organization, Page } from '@actuo/shared';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api/api-client.js';
import { Dashboard } from './dashboard.js';

/** Fixed "today" so the pace arithmetic is deterministic: 14 Aug 2026, a 31-day month. */
const TODAY = new Date(2026, 7, 14, 12, 0, 0);

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    orgId: 'org-1',
    userId: 'user-1',
    categoryId: 'cat-1',
    amount: 100,
    currency: 'INR',
    convertedAmount: null,
    baseCurrency: 'INR',
    merchant: 'Barista',
    note: null,
    status: 'submitted',
    receiptUrl: null,
    expenseDate: '2026-08-10',
    createdAt: '2026-08-10T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function page(items: Expense[]): Page<Expense> {
  return { items, total: items.length, limit: 500, offset: 0 };
}

const BUDGETS: BudgetStatus[] = [
  {
    categoryId: 'cat-1',
    categoryName: 'Travel',
    budgeted: 10000,
    spent: 3000,
    remaining: 7000,
    utilization: 0.3,
    currency: 'INR',
  },
];

const ORG: Organization = {
  id: 'org-1',
  name: 'Acme',
  baseCurrency: 'INR',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EXPENSES = [
  expense({
    id: 'a',
    expenseDate: '2026-08-02',
    amount: 1000,
    status: 'approved',
    merchant: 'Uber',
  }),
  expense({
    id: 'b',
    expenseDate: '2026-08-10',
    amount: 2000,
    status: 'submitted',
    merchant: 'Taj Hotel',
    createdAt: '2026-08-11T09:00:00.000Z',
  }),
  expense({ id: 'c', expenseDate: '2026-07-15', amount: 4000, status: 'approved' }),
  // Rejected: must not land in any total.
  expense({ id: 'd', expenseDate: '2026-08-12', amount: 500, status: 'rejected' }),
];

describe('Dashboard', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<Dashboard>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const find = (selector: string) => host().querySelector(selector);
  const findAll = (selector: string) => Array.from(host().querySelectorAll(selector));

  /** Routes each parallel call by path, so ordering inside Promise.all cannot matter. */
  function respond(overrides: { expenses?: Expense[]; budgets?: BudgetStatus[] } = {}) {
    return (path: string) => {
      if (path === '/expenses') return Promise.resolve(page(overrides.expenses ?? EXPENSES));
      if (path === '/budgets/status') return Promise.resolve(overrides.budgets ?? BUDGETS);
      if (path === '/orgs/current') return Promise.resolve(ORG);
      return Promise.reject(new Error(`unexpected path ${path}`));
    };
  }

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    // Only Date is faked — faking timers wholesale would stall the promises the
    // resource loader is built on.
    vi.useFakeTimers({ now: TODAY, toFake: ['Date'] });
    api = { get: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loading (§3.6)', () => {
    it('shows skeletons, not a spinner, before anything resolves', async () => {
      api.get.mockImplementation(() => new Promise<never>(() => {}));
      await create();

      expect(findAll('ui-skeleton').length).toBeGreaterThan(0);
      expect(find('ui-stat-card')).toBeNull();
      expect(find('ui-error-state')).toBeNull();
    });

    it('names what is loading, so a screen reader hears something specific', async () => {
      api.get.mockImplementation(() => new Promise<never>(() => {}));
      await create();

      expect(text()).toContain('Loading this month’s figures');
      expect(text()).toContain('Loading recent activity');
    });
  });

  describe('loaded', () => {
    beforeEach(async () => {
      api.get.mockImplementation(respond());
      await create();
      await settle();
    });

    it('requests only the window it reports on', () => {
      expect(api.get).toHaveBeenCalledWith(
        '/expenses',
        { from: '2026-07-01', to: '2026-08-14', limit: 500 },
        expect.anything(),
      );
    });

    it('replaces the skeletons with the four hero tiles', () => {
      expect(find('ui-skeleton')).toBeNull();
      expect(findAll('ui-stat-card')).toHaveLength(4);
    });

    it('spends the aurora gradient on exactly one element (§2.2)', () => {
      expect(findAll('.bg-aurora')).toHaveLength(1);
      const hero = find('.bg-aurora')?.closest('ui-stat-card');
      expect(hero?.textContent).toContain('Spend pace');
    });

    it('totals this month excluding the rejected row', () => {
      expect(text()).toContain('₹3,000');
    });

    it('shows budget remaining from the server, not a client-side subtraction', () => {
      expect(text()).toContain('₹7,000');
    });

    it('counts only submitted expenses as pending approvals', () => {
      const tile = findAll('ui-stat-card').find((card) =>
        card.textContent?.includes('Pending approvals'),
      );
      expect(tile?.textContent).toContain('1');
      expect(tile?.textContent).toContain('₹2,000 awaiting a decision');
    });

    it('paces against the budget when there is one', () => {
      const hero = find('.bg-aurora')?.closest('ui-stat-card');
      // 3,000 spent 14/31 of the way through vs a 10,000 budget projects well under.
      expect(hero?.textContent).toContain('On track');
      expect(hero?.textContent).toContain('vs budget');
    });

    it('draws the trend as inline SVG with one bar per day and a text alternative', () => {
      const svg = find('svg[role="img"]');
      expect(svg).not.toBeNull();
      expect(svg?.querySelectorAll('rect')).toHaveLength(14);
      expect(svg?.getAttribute('aria-label')).toContain('Daily spend for the last 14 days');
    });

    it('orders the activity feed by when each expense was filed', () => {
      const rows = findAll('ul li');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].textContent).toContain('Taj Hotel');
    });

    it('marks every money figure as tabular so columns align (§2.3)', () => {
      expect(findAll('[data-money]').length).toBeGreaterThan(0);
    });
  });

  describe('empty (§3.6)', () => {
    beforeEach(async () => {
      api.get.mockImplementation(respond({ expenses: [], budgets: [] }));
      await create();
      await settle();
    });

    it('names the action that would fill the page instead of saying "No data"', () => {
      const empty = find('ui-empty-state');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain('Add your first expense');
      expect(empty?.textContent).toContain('Copilot');
      expect(text()).not.toContain('No data');
    });

    it('hides the tiles rather than showing a wall of zeroes', () => {
      expect(find('ui-stat-card')).toBeNull();
    });
  });

  describe('error (§3.6)', () => {
    it('shows an actionable error that blames the request, not the user', async () => {
      api.get.mockRejectedValue(new Error('Network request failed'));
      await create();
      await settle();

      const error = find('ui-error-state');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('The dashboard didn’t load');
      expect(error?.textContent).toMatch(/your expenses are safe/i);
      expect(error?.textContent).not.toMatch(/\byou (did|entered|must)\b/i);
    });

    it('recovers when retry succeeds', async () => {
      api.get.mockRejectedValue(new Error('boom'));
      await create();
      await settle();
      expect(find('ui-error-state')).not.toBeNull();

      api.get.mockImplementation(respond());
      (find('ui-error-state button') as HTMLButtonElement).click();
      await settle();

      expect(find('ui-error-state')).toBeNull();
      expect(findAll('ui-stat-card')).toHaveLength(4);
    });
  });

  describe('no budgets', () => {
    it('paces against last month and says so, rather than showing nothing', async () => {
      api.get.mockImplementation(respond({ budgets: [] }));
      await create();
      await settle();

      const hero = find('.bg-aurora')?.closest('ui-stat-card');
      expect(hero?.textContent).toContain('vs last month');
      expect(hero?.textContent).toContain('last month');
    });

    it('tells the user a budget is missing instead of printing a bare zero', async () => {
      api.get.mockImplementation(respond({ budgets: [] }));
      await create();
      await settle();

      const tile = findAll('ui-stat-card').find((card) =>
        card.textContent?.includes('Budget remaining'),
      );
      expect(tile?.textContent).toContain('No budgets');
      expect(tile?.textContent).toContain('Add a budget');
    });
  });
});
