import type { BudgetStatus } from '@actuo/shared';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api/api-client.js';
import { Budgets } from './budgets.js';

function budget(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  const budgeted = overrides.budgeted ?? 10000;
  const spent = overrides.spent ?? 3000;
  return {
    categoryId: 'cat-1',
    categoryName: 'Travel',
    budgeted,
    spent,
    remaining: budgeted - spent,
    utilization: budgeted > 0 ? spent / budgeted : Number.POSITIVE_INFINITY,
    currency: 'INR',
    unconvertedCount: 0,
    ...overrides,
  };
}

const HEALTHY: BudgetStatus[] = [
  budget({ categoryId: 'a', categoryName: 'Travel', budgeted: 10000, spent: 3000 }),
  budget({ categoryId: 'b', categoryName: 'Meals', budgeted: 4000, spent: 3400 }),
  budget({ categoryId: 'c', categoryName: 'Software', budgeted: 2000, spent: 100 }),
];

const WITH_OVERSPEND: BudgetStatus[] = [
  budget({ categoryId: 'a', categoryName: 'Travel', budgeted: 10000, spent: 12500 }),
  budget({ categoryId: 'b', categoryName: 'Meals', budgeted: 4000, spent: 1000 }),
];

describe('Budgets', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<Budgets>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const find = (selector: string) => host().querySelector(selector);
  const findAll = (selector: string) => Array.from(host().querySelectorAll(selector));

  const rows = () => findAll('ul li');
  const bars = () => findAll('[role="progressbar"]');

  function create(): void {
    fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = { get: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  });

  describe('loading (§3.6)', () => {
    it('shows skeletons rather than a spinner', async () => {
      api.get.mockImplementation(() => new Promise<never>(() => {}));
      create();

      expect(findAll('ui-skeleton').length).toBeGreaterThan(0);
      expect(find('[role="progressbar"]')).toBeNull();
      expect(text()).toContain('Loading budgets by category');
    });
  });

  describe('loaded', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue(HEALTHY);
      create();
      await settle();
    });

    it('reads the server’s status endpoint', () => {
      expect(api.get).toHaveBeenCalledWith('/budgets/status', undefined, expect.anything());
    });

    it('renders a bar per category plus the org-wide total', () => {
      expect(rows()).toHaveLength(3);
      expect(bars()).toHaveLength(4);
    });

    it('orders the tightest category first', () => {
      expect(rows()[0].textContent).toContain('Meals');
      expect(rows()[2].textContent).toContain('Software');
    });

    it('lets ProgressBar run the success → warning → danger ramp', () => {
      const meals = rows()[0].querySelector('[role="progressbar"] div') as HTMLElement;
      const software = rows()[2].querySelector('[role="progressbar"] div') as HTMLElement;
      // Meals is at 85%, Software at 5%.
      expect(meals.className).toContain('bg-status-warning');
      expect(software.className).toContain('bg-status-success');
    });

    it('shows spent, budgeted and what is left, as tabular money', () => {
      const travel = rows().find((row) => row.textContent?.includes('Travel'));
      expect(travel?.textContent).toContain('₹3,000 of ₹10,000');
      expect(travel?.textContent).toContain('₹7,000 left');
      expect(travel?.querySelector('[data-money]')).not.toBeNull();
    });

    it('says nothing about being over budget when nothing is', () => {
      expect(text()).not.toContain('Over budget');
      expect(find('ui-badge')).toBeNull();
    });
  });

  describe('over budget', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue(WITH_OVERSPEND);
      create();
      await settle();
    });

    it('calls it out explicitly at the top, and announces it', () => {
      const callout = find('[role="status"].border-status-danger\\/30');
      expect(callout).not.toBeNull();
      expect(callout?.textContent).toContain('Travel is over budget');
      expect(callout?.textContent).toContain('₹2,500 over');
    });

    it('pluralises the callout when several categories are over', async () => {
      api.get.mockResolvedValue([
        budget({ categoryId: 'a', categoryName: 'Travel', budgeted: 1000, spent: 1400 }),
        budget({ categoryId: 'b', categoryName: 'Meals', budgeted: 1000, spent: 1100 }),
      ]);
      create();
      await settle();

      expect(text()).toContain('2 categories are over budget');
      expect(text()).toContain('₹500 past the limit in total');
    });

    it('badges the offending row, so the colour is not the only signal', () => {
      const travel = rows().find((row) => row.textContent?.includes('Travel'));
      expect(travel?.querySelector('ui-badge')?.textContent).toContain('Over budget');
    });

    it('lets the bar state how far over, in words', () => {
      const travel = rows().find((row) => row.textContent?.includes('Travel'));
      expect(travel?.textContent).toContain('Over by 25%');
      expect(travel?.textContent).toContain('₹2,500 over');
    });

    it('does not overstate the org total — a healthy category offsets it', () => {
      // Travel is 2,500 over, Meals has 3,000 left: 500 left overall.
      expect(text()).toContain('₹500 left this month.');
    });
  });

  describe('unconverted spend', () => {
    /**
     * The server's `spent` excludes expenses it could not express in the base
     * currency, because there is no FX pass (PRD §6.5). A bar drawn from a
     * partial figure with nothing saying so reads as a complete one.
     */
    it('says how many expenses the figures leave out', async () => {
      api.get.mockResolvedValue([
        budget({ categoryId: 'a', categoryName: 'Travel', unconvertedCount: 2 }),
        budget({ categoryId: 'b', categoryName: 'Meals', unconvertedCount: 1 }),
      ]);
      create();
      await settle();

      expect(text()).toContain('3 expenses in other currencies');
    });

    it('says nothing when every expense was in the base currency', async () => {
      api.get.mockResolvedValue(HEALTHY);
      create();
      await settle();

      expect(text()).not.toContain('in other currencies');
    });
  });

  describe('empty (§3.6)', () => {
    it('names how a budget gets created instead of saying "No data"', async () => {
      api.get.mockResolvedValue([]);
      create();
      await settle();

      const empty = find('ui-empty-state');
      expect(empty?.textContent).toContain('No budgets set yet');
      expect(empty?.textContent).toContain('Settings');
      expect(text()).not.toContain('No data');
      expect(find('[role="progressbar"]')).toBeNull();
    });
  });

  describe('error (§3.6)', () => {
    it('is actionable and does not blame the user', async () => {
      api.get.mockRejectedValue(new Error('Network request failed'));
      create();
      await settle();

      const error = find('ui-error-state');
      expect(error?.textContent).toContain('Budgets didn’t load');
      expect(error?.textContent).toContain('untouched');
      expect(error?.textContent).not.toMatch(/\byou (did|entered|must)\b/i);
    });

    it('renders the bars when retry succeeds', async () => {
      api.get.mockRejectedValue(new Error('boom'));
      create();
      await settle();
      expect(find('ui-error-state')).not.toBeNull();

      api.get.mockResolvedValue(HEALTHY);
      (find('ui-error-state button') as HTMLButtonElement).click();
      await settle();

      expect(find('ui-error-state')).toBeNull();
      expect(rows()).toHaveLength(3);
    });
  });

  describe('a zero budget', () => {
    it('does not paint an infinite bar when a category has no budget but has spend', async () => {
      api.get.mockResolvedValue([
        budget({ categoryId: 'a', categoryName: 'Misc', budgeted: 0, spent: 900, remaining: -900 }),
      ]);
      create();
      await settle();

      const bar = rows()[0].querySelector('[role="progressbar"]');
      expect(bar?.getAttribute('aria-valuenow')).toBe('100');
      expect(text()).toContain('₹900 over');
      // …and the org total says so in words rather than drawing an empty bar.
      expect(text()).toContain('₹900 over budget overall.');
    });
  });
});
