import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { APP_DESTINATIONS } from '@actuo/shared';
import { routes } from '../app.routes.js';
import { authGuard } from '../core/session/auth-guard.js';

/**
 * `APP_DESTINATIONS` is what an agent is told the app contains, and it lives in
 * `@actuo/shared` while the routes live here — two files that have to agree.
 *
 * The invariant is exact in both directions: **every `authGuard`-protected
 * route is a destination, and every destination is an `authGuard`-protected
 * route.** That is stricter than "the paths resolve", and deliberately so —
 * a one-directional check lets a new gated page ship undescribed, which is the
 * failure that matters. An agent cannot navigate to a page nobody told it about,
 * and it is exactly the page a human would have added a nav tab for.
 *
 * If a future route genuinely should be reachable by a person but not by an
 * agent, add it to `NOT_A_DESTINATION` with the reason. The list is empty today
 * because every gated page is somewhere an agent may usefully send the user.
 *
 * Same idea as `shared/src/page-limit-contract.spec.ts` and
 * `report-format-contract.spec.ts`: pin the two definitions together rather
 * than trusting them to be updated in step.
 */
const NOT_A_DESTINATION: readonly string[] = [];

function isGated(route: Route): boolean {
  return (route.canActivate ?? []).includes(authGuard);
}

/** `app.routes.ts` declares paths without the leading slash. */
function pathOf(route: Route): string {
  return `/${route.path ?? ''}`;
}

describe('navigate_to destinations', () => {
  const gatedPaths = routes.filter(isGated).map(pathOf);

  it('finds the authenticated routes it is describing', () => {
    // A sanity floor: if the route table is ever read wrongly, the two
    // assertions below would both pass over an empty list and prove nothing.
    expect(gatedPaths.length).toBeGreaterThan(0);
  });

  it('describes every authenticated page', () => {
    const described = new Set(APP_DESTINATIONS.map((d) => d.path));
    const undescribed = gatedPaths.filter(
      (path) => !described.has(path) && !NOT_A_DESTINATION.includes(path),
    );

    expect(undescribed).toEqual([]);
  });

  it('describes no page that is not an authenticated route', () => {
    const gated = new Set(gatedPaths);
    const stale = APP_DESTINATIONS.filter((d) => !gated.has(d.path)).map((d) => d.path);

    expect(stale).toEqual([]);
  });

  it('gives every destination a distinct id and a real description', () => {
    const ids = APP_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const destination of APP_DESTINATIONS) {
      expect(destination.description.length).toBeGreaterThan(20);
      expect(destination.path.startsWith('/')).toBe(true);
    }
  });
});
