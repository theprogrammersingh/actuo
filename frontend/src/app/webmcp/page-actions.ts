import { Injectable } from '@angular/core';

/** What a page does when a tool hands it work. */
export type PageAction<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = (args: TArgs, context: { signal: AbortSignal }) => Promise<TResult>;

/**
 * How long a tool waits for the page that owns an action to mount.
 *
 * Generous, because the page is lazily loaded: on a cold navigation the chunk
 * has to be fetched before the component exists at all.
 */
export const PAGE_ACTION_TIMEOUT_MS = 8000;

/**
 * The rendezvous between a tool and the page that can perform it.
 *
 * ## Why tools do not just call the API
 *
 * A person cannot add an expense without going to the Add expense page, or
 * change a budget without going to the Budgets page. When a tool posts straight
 * to `/api/*` the agent gets a private back door: the work happens, the screen
 * does not move, and the user is left looking at figures that are quietly
 * wrong. So a mutating tool navigates to the page that owns the action and
 * hands the work here — the page then does it through the exact code path its
 * own buttons use, which is why the optimistic row patching, the form messages
 * and the reloads all keep working with no new plumbing.
 *
 * Modelled on {@link ToolSession} and `ConverterSession`: "which page can do
 * what right now" is session state, not component state.
 *
 * **There is deliberately no API fallback when nothing answers.** A fallback
 * would restore exactly the invisible path this exists to remove, and it would
 * do so only in the cases hardest to notice — a slow chunk, a guard redirect.
 * A timeout is an error, which the model reports and the user can see.
 */
@Injectable({ providedIn: 'root' })
export class PageActions {
  private readonly handlers = new Map<string, PageAction<never, unknown>>();
  private readonly waiting = new Map<string, Set<(handler: PageAction<never, unknown>) => void>>();

  /**
   * Publish an action for as long as the page is mounted. Returns an
   * unregister to call on destroy.
   */
  provide<TArgs extends Record<string, unknown>, TResult>(
    name: string,
    handler: PageAction<TArgs, TResult>,
  ): () => void {
    const stored = handler as unknown as PageAction<never, unknown>;
    this.handlers.set(name, stored);

    for (const resolve of this.waiting.get(name) ?? []) resolve(stored);
    this.waiting.delete(name);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      /*
       * ORDER IS SIGNIFICANT. Only clear the handler if it is still ours.
       * During a route change Angular constructs the incoming component before
       * destroying the outgoing one — the same ordering `ConverterSession`
       * documents — so an unconditional delete here would let a page being torn
       * down wipe the registration the incoming page has already made.
       */
      if (this.handlers.get(name) === stored) this.handlers.delete(name);
    };
  }

  /** Whether a mounted page can perform this action right now. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Resolve once a page provides `name`. Rejects on abort or timeout rather
   * than falling back to anything — see the class comment.
   */
  awaitHandler(
    name: string,
    signal: AbortSignal,
    timeoutMs: number = PAGE_ACTION_TIMEOUT_MS,
  ): Promise<PageAction<never, unknown>> {
    const existing = this.handlers.get(name);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      let settled = false;

      const waiters = this.waiting.get(name) ?? new Set();
      this.waiting.set(name, waiters);

      const cleanup = () => {
        waiters.delete(onProvided);
        if (waiters.size === 0) this.waiting.delete(name);
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };

      const onProvided = (handler: PageAction<never, unknown>) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(handler);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal.reason ?? new Error('Aborted.'));
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `The page that performs "${name}" did not open in time, so nothing was changed.`,
          ),
        );
      }, timeoutMs);

      waiters.add(onProvided);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
