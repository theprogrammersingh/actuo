import { EXPENSE_PAGE_MAX } from '@actuo/shared';
import type { Expense, Page } from '@actuo/shared';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api/api-client.js';
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
    api.get.mockResolvedValueOnce(page(ROWS, ROWS.length + 1));
    api.get.mockResolvedValueOnce({ items: more, total: ROWS.length + 1, limit: 100, offset: ROWS.length });

    create();
    await settle();
    loadMore()!.click();
    await settle();

    expect(api.get).toHaveBeenLastCalledWith('/expenses/search', {
      limit: 100,
      offset: ROWS.length,
    });
    // Appended, not replaced — losing page one would be worse than not paging.
    expect(text()).toContain('Later Cafe');
    expect(text()).toContain(ROWS[0].merchant!);
  });

  it('hides Load more once every row is in', async () => {
    const more: Expense[] = [{ ...ROWS[0], id: 'later-1', merchant: 'Later Cafe' }];
    api.get.mockResolvedValueOnce(page(ROWS, ROWS.length + 1));
    api.get.mockResolvedValueOnce({ items: more, total: ROWS.length + 1, limit: 100, offset: ROWS.length });

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
    api.get.mockResolvedValueOnce(page(ROWS, 250));
    api.get.mockRejectedValueOnce(new Error('Network unavailable'));

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

    for (const [, params] of api.get.mock.calls) {
      expect((params as { limit: number }).limit).toBeLessThanOrEqual(EXPENSE_PAGE_MAX);
    }
  });
});
