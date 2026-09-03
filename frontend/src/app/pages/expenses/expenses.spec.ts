import { EXPENSE_PAGE_MAX } from '@actuo/shared';
import type { Expense, Page } from '@actuo/shared';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { Expenses } from './expenses.js';

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

const ROWS: Expense[] = [
  expense({
    id: 'a',
    merchant: 'Uber',
    amount: 320,
    expenseDate: '2026-08-01',
    status: 'approved',
  }),
  expense({
    id: 'b',
    merchant: 'Taj Hotel',
    note: 'Client dinner',
    amount: 4800,
    expenseDate: '2026-08-12',
    status: 'submitted',
  }),
  expense({
    id: 'c',
    merchant: 'Barista',
    amount: 180,
    expenseDate: '2026-08-07',
    status: 'draft',
  }),
];

function page(items: Expense[], total = items.length): Page<Expense> {
  return { items, total, limit: 100, offset: 0 };
}

describe('Expenses', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<Expenses>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const find = (selector: string) => host().querySelector(selector);
  const findAll = (selector: string) => Array.from(host().querySelectorAll(selector));

  /** The desktop table is the canonical rendering; the card list mirrors it. */
  const tableRows = () => findAll('tbody tr');
  const cardRows = () => findAll('ul li');
  const rowIds = () =>
    tableRows().map((row) => row.querySelector('td:nth-child(2)')?.textContent?.trim());

  function header(name: 'Date' | 'Amount'): HTMLElement {
    const th = findAll('th').find((cell) => cell.textContent?.trim().startsWith(name));
    if (!th) throw new Error(`no ${name} header`);
    return th as HTMLElement;
  }

  function clickHeader(name: 'Date' | 'Amount'): void {
    (header(name).querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function type(value: string): void {
    const input = find('ui-input input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function selectStatus(value: string): void {
    const select = find('select') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function create(): void {
    fixture = TestBed.createComponent(Expenses);
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = { get: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  });

  describe('loading (§3.6)', () => {
    it('shows a table-shaped skeleton, not a spinner', async () => {
      api.get.mockImplementation(() => new Promise<never>(() => {}));
      create();

      expect(findAll('ui-skeleton').length).toBeGreaterThan(0);
      expect(find('table')).toBeNull();
      expect(text()).toContain('Loading expenses');
    });

    it('keeps the filter controls usable while the rows are in flight', async () => {
      api.get.mockImplementation(() => new Promise<never>(() => {}));
      create();

      expect(find('ui-input input')).not.toBeNull();
      expect(find('select')).not.toBeNull();
    });
  });

  describe('loaded', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue(page(ROWS));
      create();
      await settle();
    });

    it('fetches the first page at the maximum page size the API allows', () => {
      expect(api.get).toHaveBeenCalledWith('/expenses/search', { limit: 100, offset: 0 }, expect.anything());
    });

    it('renders one table row per expense', () => {
      expect(find('ui-skeleton')).toBeNull();
      expect(tableRows()).toHaveLength(3);
    });

    it('also renders stacked cards, so a phone never scrolls sideways (§3.1)', () => {
      expect(cardRows()).toHaveLength(3);
      expect(find('.md\\:hidden')).not.toBeNull();
    });

    it('shows a status pill per row', () => {
      expect(findAll('tbody ui-badge')).toHaveLength(3);
      expect(text()).toContain('Approved');
      expect(text()).toContain('Draft');
    });

    it('right-aligns amounts and marks them as money (§2.3)', () => {
      const amount = tableRows()[0].querySelector('td:nth-child(4)') as HTMLElement;
      expect(amount.className).toContain('text-right');
      expect(amount.className).toContain('tabular');
      expect(amount.hasAttribute('data-money')).toBe(true);
      expect(amount.textContent).toContain('₹');
    });

    it('defaults to newest first', () => {
      expect(rowIds()[0]).toContain('Taj Hotel');
      expect(header('Date').getAttribute('aria-sort')).toBe('descending');
      expect(header('Amount').getAttribute('aria-sort')).toBe('none');
    });
  });

  describe('currency labelling', () => {
    /**
     * `baseCurrency || currency` printed an unconverted $50 under the org's ₹
     * symbol. There is no FX pass (PRD §6.5), so `convertedAmount` is null for
     * every foreign row — the label was wrong for all of them, by roughly a
     * factor of ninety.
     */
    it('labels an unconverted row with the currency it was filed in', async () => {
      api.get.mockResolvedValue(
        page([expense({ id: 'usd', merchant: 'AWS', amount: 50, currency: 'USD', convertedAmount: null })]),
      );
      create();
      await settle();

      expect(text()).toContain('$');
      expect(text()).not.toContain('₹');
    });

    /**
     * The rate lookup is offered on exactly the rows the totals leave out —
     * `isConverted()` is the same predicate `sumSpend()` excludes on — so the
     * trigger appears where the question forms and nowhere else.
     */
    describe('the rate lookup', () => {
      function withConverter(rows: Expense[]): void {
        api.get.mockImplementation((path: string) =>
          path === '/config'
            ? Promise.resolve({ converterUrl: 'https://cambiaro.example/' })
            : Promise.resolve(page(rows)),
        );
        create();
      }

      it('is offered on a row in another currency', async () => {
        withConverter([
          expense({ id: 'usd', merchant: 'AWS', amount: 50, currency: 'USD', convertedAmount: null }),
        ]);
        await settle();
        await settle();

        expect(text()).toContain('What is this in INR?');
      });

      it('is not offered on a base-currency row', async () => {
        withConverter([expense({ id: 'inr', merchant: 'Barista', amount: 250 })]);
        await settle();
        await settle();

        expect(text()).not.toContain('What is this in');
      });

      it('is not offered on a row that already has a converted value', async () => {
        withConverter([
          expense({
            id: 'usd',
            merchant: 'AWS',
            amount: 50,
            currency: 'USD',
            convertedAmount: 4200,
          }),
        ]);
        await settle();
        await settle();

        expect(text()).not.toContain('What is this in');
      });

      /**
       * LOAD-BEARING. Opening the lookup must not change what the row says it
       * cost. The converter is advisory: a rate read off another site is not
       * the locked historical rate `converted_amount` would hold, so the money
       * on screen is the money that was filed. See CLAUDE.md, "Money: never add
       * two currencies".
       */
      it('does not change the amount on the row it is opened from', async () => {
        withConverter([
          expense({ id: 'usd', merchant: 'AWS', amount: 50, currency: 'USD', convertedAmount: null }),
        ]);
        await settle();
        await settle();

        const before = find('[data-money]')?.textContent?.trim();
        expect(before).toContain('$');

        const trigger = findAll('button').find((b) =>
          (b.textContent ?? '').includes('What is this in'),
        ) as HTMLButtonElement | undefined;
        expect(trigger).toBeDefined();
        trigger!.click();
        await settle();

        expect(find('[data-money]')?.textContent?.trim()).toBe(before);
        expect(text()).not.toContain('₹');
      });
    });

    it('labels a converted row with the org base currency', async () => {
      api.get.mockResolvedValue(
        page([
          expense({
            id: 'usd',
            merchant: 'AWS',
            amount: 50,
            currency: 'USD',
            convertedAmount: 4200,
            baseCurrency: 'INR',
          }),
        ]),
      );
      create();
      await settle();

      expect(text()).toContain('₹');
      expect(text()).toContain('4,200');
    });
  });

  describe('sorting', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue(page(ROWS));
      create();
      await settle();
    });

    it('flips the date column when its header is clicked again', () => {
      clickHeader('Date');
      expect(header('Date').getAttribute('aria-sort')).toBe('ascending');
      expect(rowIds()[0]).toContain('Uber');
    });

    it('switches to amount, largest first, and moves aria-sort with it', () => {
      clickHeader('Amount');
      expect(header('Amount').getAttribute('aria-sort')).toBe('descending');
      expect(header('Date').getAttribute('aria-sort')).toBe('none');
      expect(rowIds()[0]).toContain('Taj Hotel');

      clickHeader('Amount');
      expect(rowIds()[0]).toContain('Barista');
    });

    it('reorders the phone cards too, not just the table', () => {
      clickHeader('Amount');
      clickHeader('Amount');
      expect(cardRows()[0].textContent).toContain('Barista');
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue(page(ROWS));
      create();
      await settle();
    });

    it('narrows by free text without another network call', () => {
      const callsBefore = api.get.mock.calls.length;
      type('taj');

      expect(tableRows()).toHaveLength(1);
      expect(rowIds()[0]).toContain('Taj Hotel');
      expect(api.get.mock.calls).toHaveLength(callsBefore);
    });

    it('narrows by status', () => {
      selectStatus('draft');
      expect(tableRows()).toHaveLength(1);
      expect(rowIds()[0]).toContain('Barista');
    });

    it('reports how much of the list is showing', () => {
      selectStatus('draft');
      expect(text()).toContain('Showing 1 of 3.');
    });

    it('offers a clear control only once something is filtered', () => {
      expect(text()).not.toContain('Clear');
      selectStatus('draft');
      expect(text()).toContain('Clear');
    });

    it('restores the full list when filters are cleared', () => {
      type('taj');
      selectStatus('draft');
      expect(tableRows()).toHaveLength(0);

      const clear = findAll('button').find((button) => button.textContent?.trim() === 'Clear');
      (clear as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(tableRows()).toHaveLength(3);
      expect((find('ui-input input') as HTMLInputElement).value).toBe('');
    });
  });

  describe('empty (§3.6)', () => {
    it('names the action that would fill the table when there is nothing at all', async () => {
      api.get.mockResolvedValue(page([]));
      create();
      await settle();

      const empty = find('ui-empty-state');
      expect(empty?.textContent).toContain('No expenses yet');
      expect(empty?.textContent).toContain('Copilot');
      expect(text()).not.toContain('No data');
    });

    it('distinguishes "nothing matches" from "nothing exists", and offers a way out', async () => {
      api.get.mockResolvedValue(page(ROWS));
      create();
      await settle();

      type('zzz');
      const empty = find('ui-empty-state');
      expect(empty?.textContent).toContain('Nothing matches those filters');

      const clear = findAll('button').find(
        (button) => button.textContent?.trim() === 'Clear filters',
      );
      (clear as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(tableRows()).toHaveLength(3);
    });
  });

  describe('error (§3.6)', () => {
    it('offers a retry and does not blame the user', async () => {
      api.get.mockRejectedValue(new Error('Network request failed'));
      create();
      await settle();

      const error = find('ui-error-state');
      expect(error?.textContent).toContain('The expense list didn’t load');
      expect(error?.textContent).toContain('Nothing was changed');
      expect(error?.textContent).not.toMatch(/\byou (did|entered|must)\b/i);
    });

    it('loads the table when retry succeeds', async () => {
      api.get.mockRejectedValue(new Error('boom'));
      create();
      await settle();

      api.get.mockResolvedValue(page(ROWS));
      (find('ui-error-state button') as HTMLButtonElement).click();
      await settle();

      expect(find('ui-error-state')).toBeNull();
      expect(tableRows()).toHaveLength(3);
    });

    it('keeps what the user typed across the failure', async () => {
      api.get.mockRejectedValue(new Error('boom'));
      create();
      await settle();

      type('taj');
      expect((find('ui-input input') as HTMLInputElement).value).toBe('taj');
    });
  });
});

/**
 * Paging exists because the API caps a page at EXPENSE_PAGE_MAX. Asking for
 * more than that used to return a 400 and break this screen outright, so the
 * row count now comes from `total` and extra pages are appended on demand.
 */
describe('Expenses paging', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<Expenses>;

  const text = () => fixture.nativeElement.textContent as string;
  const buttons = () => Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
  const loadMore = () => buttons().find((b) => b.textContent?.includes('more'));

  function create() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    fixture = TestBed.createComponent(Expenses);
    fixture.detectChanges();
  }

  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /**
   * Queue page responses by PATH, not by call order.
   *
   * `mockResolvedValueOnce` is consumed by whichever request happens to fire
   * first, and this screen also asks `/api/config` (to decide whether to offer
   * the per-row rate lookup). Routing by path is what keeps these assertions
   * about paging rather than about request ordering — the dashboard spec makes
   * the same move, for the same reason.
   */
  function queuePages(...responses: unknown[]): void {
    const queue = [...responses];
    api.get.mockImplementation((path: string) => {
      if (path === '/config') return Promise.resolve({ converterUrl: '' });
      const next = queue.shift();
      if (next === undefined) return Promise.reject(new Error('no queued page'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
  }

  beforeEach(() => {
    api = { get: vi.fn() };
  });

  it('offers no Load more when everything already fits on one page', async () => {
    api.get.mockResolvedValue(page(ROWS));
    create();
    await settle();

    expect(loadMore()).toBeUndefined();
  });

  it('offers Load more, and says how many rows exist, when the server has more', async () => {
    api.get.mockResolvedValue(page(ROWS, 250));
    create();
    await settle();

    expect(loadMore()).toBeDefined();
    expect(text()).toContain(`Showing ${ROWS.length} of 250`);
  });

  it('requests the next page by offset and appends the rows', async () => {
    const more: Expense[] = [{ ...ROWS[0], id: 'later-1', merchant: 'Later Cafe' }];
    queuePages(page(ROWS, ROWS.length + 1), {
      items: more,
      total: ROWS.length + 1,
      limit: 100,
      offset: ROWS.length,
    });

    create();
    await settle();
    loadMore()!.click();
    await settle();

    expect(api.get).toHaveBeenCalledWith('/expenses/search', {
      limit: 100,
      offset: ROWS.length,
    });
    // Appended, not replaced — losing page one would be worse than not paging.
    expect(text()).toContain('Later Cafe');
    expect(text()).toContain(ROWS[0].merchant!);
  });

  it('hides Load more once every row is in', async () => {
    const more: Expense[] = [{ ...ROWS[0], id: 'later-1', merchant: 'Later Cafe' }];
    queuePages(page(ROWS, ROWS.length + 1), {
      items: more,
      total: ROWS.length + 1,
      limit: 100,
      offset: ROWS.length,
    });

    create();
    await settle();
    loadMore()!.click();
    await settle();

    expect(loadMore()).toBeUndefined();
  });

  /**
   * A failed page must not discard the rows already on screen — that would be
   * a worse outcome than not paging at all.
   */
  it('keeps the loaded rows when a later page fails, and says so', async () => {
    queuePages(page(ROWS, 250), new Error('Network unavailable'));

    create();
    await settle();
    loadMore()!.click();
    await settle();

    expect(text()).toContain('Network unavailable');
    expect(text()).toContain(ROWS[0].merchant!);
    expect(fixture.nativeElement.querySelector('ui-error-state')).toBeNull();
  });

  it('never asks for more than the API allows', async () => {
    api.get.mockResolvedValue(page(ROWS, 250));
    create();
    await settle();
    loadMore()!.click();
    await settle();

    const pageCalls = api.get.mock.calls.filter(([path]) => path !== '/config');
    expect(pageCalls.length).toBeGreaterThan(0);
    for (const [, params] of pageCalls) {
      expect((params as { limit: number }).limit).toBeLessThanOrEqual(EXPENSE_PAGE_MAX);
    }
  });
});

/**
 * PRD §6.2 / §6.4 — the workflow controls. Until these landed the Expenses page
 * was read-only, so the approval flow looked like something only the Copilot
 * could drive.
 *
 * These assert the *offer*, not the enforcement: the server re-checks role,
 * legality and ownership on every call (see the RBAC e2e suite). What is tested
 * here is that a button which would 403 is never rendered.
 */
describe('Expenses workflow actions', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';

  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let session: {
    role: ReturnType<typeof signal<string | null>>;
    user: ReturnType<typeof signal<{ id: string } | null>>;
    refreshPendingApprovals: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<Expenses>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const tableRows = () => Array.from(host().querySelectorAll('tbody tr'));

  /** Buttons in a row's action cell, by visible label. */
  function actionsOn(index = 0): string[] {
    const cell = tableRows()[index]?.querySelector('td:last-child');
    return Array.from(cell?.querySelectorAll('button') ?? []).map(
      (b) => (b.textContent ?? '').trim(),
    );
  }

  function click(label: string, index = 0): void {
    const cell = tableRows()[index]?.querySelector('td:last-child');
    const button = Array.from(cell?.querySelectorAll('button') ?? []).find(
      (b) => (b.textContent ?? '').trim() === label,
    ) as HTMLButtonElement | undefined;
    if (!button) throw new Error(`no "${label}" button; found: ${actionsOn(index).join(', ')}`);
    button.click();
    fixture.detectChanges();
  }

  async function create(rows: Expense[], role: string | null = 'owner'): Promise<void> {
    api.get.mockResolvedValue(page(rows));
    session.role.set(role);
    fixture = TestBed.createComponent(Expenses);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = {
      get: vi.fn(),
      post: vi.fn().mockImplementation(async () => expense({ id: 'a', status: 'approved' })),
      delete: vi.fn().mockResolvedValue(null),
    };
    session = {
      role: signal<string | null>('owner'),
      user: signal<{ id: string } | null>({ id: ME }),
      refreshPendingApprovals: vi.fn().mockResolvedValue(0),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Session, useValue: session },
      ],
    });
  });

  describe('what is offered', () => {
    it('offers approve and reject on a submitted row to an owner', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);
      expect(actionsOn()).toEqual(['Approve', 'Reject']);
    });

    it('offers nothing on that row to a member', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })], 'member');
      expect(actionsOn()).toEqual([]);
    });

    it('offers submit and delete on your own draft', async () => {
      await create([expense({ id: 'a', status: 'draft', userId: ME })], 'member');
      expect(actionsOn()).toEqual(['Submit', 'Delete']);
    });

    it('lets an approver submit someone else’s draft, matching the server', async () => {
      await create([expense({ id: 'a', status: 'draft', userId: OTHER })]);
      expect(actionsOn()).toEqual(['Submit']);
    });

    /**
     * Segregation of duties. The server refuses a self-decision, so a button
     * here would be one that always 403s.
     */
    it('never offers approve or reject on your own submitted row', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: ME })]);
      expect(actionsOn()).toEqual([]);
    });

    it('offers nothing on a reimbursed row — it is terminal', async () => {
      await create([expense({ id: 'a', status: 'reimbursed', userId: ME })]);
      expect(actionsOn()).toEqual([]);
    });
  });

  describe('running an action', () => {
    it('asks for an optional note before a decision, rather than firing immediately', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);

      click('Approve');

      expect(api.post).not.toHaveBeenCalled();
      expect(text()).toContain('Add a note (optional)');
    });

    it('posts the decision with the note to the action route', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);
      click('Approve');

      const textarea = host().querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Receipts check out.';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click('Approve');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(api.post).toHaveBeenCalledWith('/expenses/a/approve', {
        comment: 'Receipts check out.',
      });
    });

    it('runs a no-comment action straight away', async () => {
      await create([expense({ id: 'a', status: 'draft', userId: ME })], 'member');

      click('Submit');
      await fixture.whenStable();

      expect(api.post).toHaveBeenCalledWith('/expenses/a/submit', {});
    });

    /**
     * The row is patched in place. Reloading would discard every `Load more`
     * page and the scroll position after acting on one row of forty.
     */
    it('updates the row from the response without refetching the page', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);
      const fetchesBefore = api.get.mock.calls.length;

      click('Approve');
      click('Approve');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('Approved');
      expect(api.get.mock.calls).toHaveLength(fetchesBefore);
    });

    /** A decision changes the queue that gates the `approve_expense` tool. */
    it('re-checks the pending approval queue afterwards', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);
      click('Approve');
      click('Approve');
      await fixture.whenStable();

      expect(session.refreshPendingApprovals).toHaveBeenCalled();
    });

    it('explains a 409 as someone else having moved it first', async () => {
      await create([expense({ id: 'a', status: 'submitted', userId: OTHER })]);
      api.post.mockRejectedValue(new ApiError('Conflict', 409, null));

      click('Approve');
      click('Approve');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('Someone else changed this expense first');
    });
  });

  describe('deleting', () => {
    it('arms before it deletes, so one stray click cannot remove a row', async () => {
      await create([expense({ id: 'a', status: 'draft', userId: ME })], 'member');

      click('Delete');
      expect(api.delete).not.toHaveBeenCalled();
      expect(actionsOn()).toContain('Confirm delete');

      click('Confirm delete');
      await fixture.whenStable();
      expect(api.delete).toHaveBeenCalledWith('/expenses/a');
    });

    it('drops the row from the table once deleted', async () => {
      await create([
        expense({ id: 'a', merchant: 'Barista', status: 'draft', userId: ME }),
        expense({ id: 'b', merchant: 'Uber', status: 'draft', userId: ME }),
      ], 'member');

      click('Delete');
      click('Confirm delete');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(tableRows()).toHaveLength(1);
      expect(text()).not.toContain('Barista');
    });
  });
});
