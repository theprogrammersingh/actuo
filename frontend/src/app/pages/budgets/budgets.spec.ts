import type { BudgetStatus } from '@actuo/shared';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { PageActions } from '../../webmcp/page-actions.js';
import { Budgets } from './budgets.js';

function budget(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  const declaredBudget = overrides.declaredBudget ?? overrides.budgeted ?? 10000;
  const carryforward = overrides.carryforward ?? 0;
  const budgeted = overrides.budgeted ?? declaredBudget + carryforward;
  const spent = overrides.spent ?? 3000;
  return {
    categoryId: 'cat-1',
    categoryName: 'Travel',
    budgeted,
    declaredBudget,
    carryforward,
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

    it('shows no "Over budget" danger badge when nothing is over', () => {
      expect(text()).not.toContain('Over budget');
      // Warning badges for "Nearing budget" may be present (e.g. Meals at 85%).
      expect(find('ui-badge[tone="danger"]')).toBeNull();
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

/**
 * PRD §6.3. `POST /api/budgets` shipped with no caller, so the empty state's
 * advice to add the first budget could not be followed from anywhere in the app.
 */
describe('Budgets — setting one', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch?: ReturnType<typeof vi.fn>;
  };
  let session: { role: ReturnType<typeof signal<string | null>> };
  let fixture: ComponentFixture<Budgets>;
  /** Budget rows the org already has; drives which categories are offered. */
  let existingBudgets: unknown[];

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const form = () => host().querySelector('form');
  const amountInput = () => host().querySelector('input[type="number"]') as HTMLInputElement;

  function setAmount(value: string): void {
    const input = amountInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    form()!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();
  }

  async function create(role: string | null = 'owner'): Promise<void> {
    session.role.set(role);
    fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = {
      get: vi.fn().mockImplementation(async (path: string) => {
        if (path === '/orgs/current/categories') {
          return [
            { id: 'cat-travel', orgId: 'org-1', name: 'Travel', icon: null, isDefault: true },
            { id: 'cat-meals', orgId: 'org-1', name: 'Meals', icon: null, isDefault: true },
          ];
        }
        if (path === '/budgets') return existingBudgets;
        return HEALTHY;
      }),
      post: vi.fn().mockResolvedValue({ id: 'b1' }),
    };
    session = { role: signal<string | null>('owner') };
    existingBudgets = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Session, useValue: session },
      ],
    });
  });

  it('offers the form to an owner', async () => {
    await create('owner');
    expect(form()).not.toBeNull();
    expect(text()).toContain('Set a budget');
  });

  /** Mirrors @Roles('owner','admin') on the route. The server still enforces it. */
  it('hides the form from a member rather than letting them hit a 403', async () => {
    await create('member');
    expect(form()).toBeNull();
  });

  it('lists the org’s categories, plus an org-wide option', async () => {
    await create();
    const options = Array.from(host().querySelectorAll('select option')).map((o) => o.textContent?.trim());
    expect(options).toContain('All categories');
    expect(options).toContain('Travel');
  });

  /**
   * `POST /api/budgets` inserts, and a unique index makes a second one a 409.
   * Offering a category that already has one would be a guaranteed failure —
   * the same rule the expense action buttons follow.
   */
  it('does not offer a category that already has a budget', async () => {
    existingBudgets = [
      { id: 'b1', orgId: 'org-1', categoryId: 'cat-travel', amount: 60000, period: 'monthly', rollover: false },
    ];
    await create();

    const options = Array.from(host().querySelectorAll('select option')).map((o) => o.textContent?.trim());
    expect(options).not.toContain('Travel');
    expect(options).toContain('Meals');
  });

  it('drops the org-wide option once an org-wide budget exists', async () => {
    existingBudgets = [
      { id: 'b1', orgId: 'org-1', categoryId: null, amount: 180000, period: 'monthly', rollover: false },
    ];
    await create();

    const options = Array.from(host().querySelectorAll('select option')).map((o) => o.textContent?.trim());
    expect(options).not.toContain('All categories');
  });

  it('still shows the form for editing when every category has a budget', async () => {
    existingBudgets = [
      { id: 'b1', orgId: 'org-1', categoryId: null, amount: 1, period: 'monthly', rollover: false },
      { id: 'b2', orgId: 'org-1', categoryId: 'cat-travel', amount: 1, period: 'monthly', rollover: false },
      { id: 'b3', orgId: 'org-1', categoryId: 'cat-meals', amount: 1, period: 'monthly', rollover: false },
    ];
    await create();

    // Form is still present for editing existing budgets
    expect(host().querySelector('form')).not.toBeNull();
  });

  it('explains a 409 in terms of what the API actually does', async () => {
    await create();
    api.post.mockRejectedValue(new ApiError('Budget already exists.', 409, null));

    setAmount('10000');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text()).toContain('already has a budget');
  });

  it('posts the budget and reloads the figures from the server', async () => {
    await create();
    const fetchesBefore = api.get.mock.calls.filter((c) => c[0] === '/budgets/status').length;

    setAmount('10000');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledWith('/budgets', {
      categoryId: null,
      amount: 10000,
      period: 'monthly',
      rollover: false,
    });
    // The bars are server-computed, so they have to come back from it.
    const fetchesAfter = api.get.mock.calls.filter((c) => c[0] === '/budgets/status').length;
    expect(fetchesAfter).toBeGreaterThan(fetchesBefore);
  });

  it('offers a rollover checkbox and sends the flag in the POST', async () => {
    await create();

    const checkbox = host().querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(host().textContent).toContain('Roll over unused');

    // Check the box
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    setAmount('5000');
    submit();
    await fixture.whenStable();

    expect(api.post).toHaveBeenCalledWith('/budgets', expect.objectContaining({ rollover: true }));
  });

  it('sends the chosen category rather than the empty org-wide value', async () => {
    await create();
    const select = host().querySelector('select') as HTMLSelectElement;
    select.value = 'cat-travel';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    setAmount('4000');
    submit();
    await fixture.whenStable();

    expect(api.post.mock.calls[0][1]).toMatchObject({ categoryId: 'cat-travel' });
  });

  it('refuses a non-positive amount without calling the API', async () => {
    await create();
    setAmount('0');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.post).not.toHaveBeenCalled();
    expect(text()).toContain('greater than zero');
  });

  it('says so, without blaming, when the save fails', async () => {
    await create();
    api.post.mockRejectedValue(new ApiError('Forbidden', 403, null));

    setAmount('10000');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text()).toContain('Only an owner or admin can manage budgets.');
  });

  /** A missing category list must not block the org-wide budget. */
  it('still renders the form when categories fail to load', async () => {
    api.get.mockImplementation(async (path: string) => {
      if (path === '/orgs/current/categories') throw new ApiError('nope', 500, null);
      if (path === '/budgets') return [];
      return HEALTHY;
    });
    await create();

    expect(form()).not.toBeNull();
  });

  /**
   * A person cannot change a budget without coming here and using this form,
   * so `set_budget` does not either: the tool navigates here and hands the
   * values over, and they go out through `commit()` — the same code the Save
   * button runs.
   */
  describe('as the page that performs set_budget', () => {
    /** Zero stagger: these tests have no interest in watching it fill. */
    function handler() {
      (fixture.componentInstance as unknown as { fillStaggerMs: number }).fillStaggerMs = 0;
      return TestBed.inject(PageActions).awaitHandler(
        'set_budget',
        new AbortController().signal,
      );
    }

    it('offers the action while mounted and withdraws it on destroy', async () => {
      await create('owner');
      const pages = TestBed.inject(PageActions);
      expect(pages.has('set_budget')).toBe(true);

      fixture.destroy();

      expect(pages.has('set_budget')).toBe(false);
    });

    it('creates a budget for a category that has none', async () => {
      await create('owner');

      const run = await handler();
      await run({ categoryId: 'cat-travel', amount: 20000 } as never, {
        signal: new AbortController().signal,
      });

      expect(api.post).toHaveBeenCalledWith('/budgets', {
        categoryId: 'cat-travel',
        amount: 20000,
        period: 'monthly',
        rollover: false,
      });
    });

    /** Creating and updating are different requests; the form decides which. */
    it('updates the existing budget rather than creating a second one', async () => {
      existingBudgets = [
        { id: 'b-travel', categoryId: 'cat-travel', amount: 5000, rollover: false },
      ];
      api.patch = vi.fn().mockResolvedValue({ id: 'b-travel' });
      await create('owner');

      const run = await handler();
      await run({ categoryId: 'cat-travel', amount: 20000 } as never, {
        signal: new AbortController().signal,
      });

      expect(api.patch).toHaveBeenCalledWith('/budgets/b-travel', {
        amount: 20000,
        rollover: false,
      });
      expect(api.post).not.toHaveBeenCalled();
    });

    it('treats an omitted category as the organization-wide budget', async () => {
      await create('owner');

      const run = await handler();
      await run({ amount: 100000 } as never, { signal: new AbortController().signal });

      expect(api.post).toHaveBeenCalledWith('/budgets', {
        categoryId: null,
        amount: 100000,
        period: 'monthly',
        rollover: false,
      });
    });

    it('fills the visible form on the way, so the change is watchable', async () => {
      await create('owner');
      /*
       * Sampled at the moment of the save. `detectChanges()` here stands in for
       * the render Angular performs during the pause between filling the form
       * and committing it.
       */
      let onScreen: string | undefined;
      api.post.mockImplementation(() => {
        fixture.detectChanges();
        onScreen = amountInput()?.value;
        return Promise.resolve({ id: 'b1' });
      });

      const run = await handler();
      await run({ categoryId: 'cat-travel', amount: 20000 } as never, {
        signal: new AbortController().signal,
      });

      expect(onScreen).toBe('20000');
    });

    /**
     * The route is `@Roles('owner','admin')`. A member's call must come back as
     * the refusal the form already words, not as a silent no-op the model would
     * report as success.
     */
    it('reports a refusal instead of claiming the budget was saved', async () => {
      await create('owner');
      api.post.mockRejectedValue(new ApiError('Forbidden', 403, null));

      const run = await handler();

      await expect(
        run({ categoryId: 'cat-travel', amount: 20000 } as never, {
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
    });

    it('rejects an amount the form itself would refuse', async () => {
      await create('owner');

      const run = await handler();

      await expect(
        run({ categoryId: 'cat-travel', amount: 0 } as never, {
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
      expect(api.post).not.toHaveBeenCalled();
    });
  });
});
