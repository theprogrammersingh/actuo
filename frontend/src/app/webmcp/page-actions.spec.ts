import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageActions } from './page-actions.js';

describe('PageActions', () => {
  let pages: PageActions;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    pages = TestBed.inject(PageActions);
  });

  const live = () => new AbortController().signal;

  it('hands a tool the handler a mounted page provided', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    pages.provide('submit_expense', handler);

    const run = await pages.awaitHandler('submit_expense', live());
    await run({ amount: 5 } as never, { signal: live() });

    expect(handler).toHaveBeenCalledWith({ amount: 5 }, expect.anything());
  });

  it('waits for a page that has not mounted yet', async () => {
    const waiting = pages.awaitHandler('set_budget', live());

    const handler = vi.fn().mockResolvedValue('saved');
    pages.provide('set_budget', handler);

    await expect(waiting).resolves.toBe(handler);
  });

  it('reports nothing mounted before a page provides the action', () => {
    expect(pages.has('set_budget')).toBe(false);
    pages.provide('set_budget', vi.fn());
    expect(pages.has('set_budget')).toBe(true);
  });

  /**
   * LOAD-BEARING. There is no API fallback, deliberately. Falling back would
   * restore the invisible path this whole seam exists to remove, and it would
   * do it only when something went wrong — a slow chunk, a guard redirect.
   */
  it('fails when no page turns up, rather than doing the work invisibly', async () => {
    vi.useFakeTimers();
    try {
      const waiting = pages.awaitHandler('submit_expense', live(), 50);
      const assertion = expect(waiting).rejects.toThrow(/did not open in time/);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up when the agent is stopped mid-wait', async () => {
    const controller = new AbortController();
    const waiting = pages.awaitHandler('submit_expense', controller.signal);

    controller.abort(new Error('Stopped.'));

    await expect(waiting).rejects.toThrow('Stopped.');
  });

  it('stops offering an action once the page is destroyed', () => {
    const release = pages.provide('set_budget', vi.fn());
    release();
    expect(pages.has('set_budget')).toBe(false);
  });

  it('ignores a double release', () => {
    const release = pages.provide('set_budget', vi.fn());
    release();
    pages.provide('set_budget', vi.fn());
    release();

    expect(pages.has('set_budget')).toBe(true);
  });

  /**
   * ORDER IS SIGNIFICANT. During a route change Angular constructs the
   * incoming component before destroying the outgoing one — the same ordering
   * `ConverterSession` documents. If teardown deleted unconditionally, the page
   * being destroyed would wipe the registration the new page just made, and the
   * action would vanish exactly when a tool navigated to reach it.
   */
  it('lets an incoming page keep its registration when the outgoing one tears down', async () => {
    const outgoing = vi.fn();
    const releaseOutgoing = pages.provide('submit_expense', outgoing);

    const incoming = vi.fn();
    pages.provide('submit_expense', incoming);

    releaseOutgoing();

    expect(pages.has('submit_expense')).toBe(true);
    await expect(pages.awaitHandler('submit_expense', live())).resolves.toBe(incoming);
  });
});
