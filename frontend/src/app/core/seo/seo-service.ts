import { Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/** What a route declares about indexing. Absent means "not indexable". */
export type RobotsDirective = 'index, follow' | 'noindex, nofollow';

export const INDEXABLE: RobotsDirective = 'index, follow';
export const NOT_INDEXABLE: RobotsDirective = 'noindex, nofollow';

/** Route `data` this service reads. */
export interface SeoRouteData {
  robots?: RobotsDirective;
}

/**
 * Keeps the `robots` meta tag honest as the user navigates (PRD §8.5).
 *
 * The bug this exists to fix: `landing.ts` set `robots: index, follow` in its
 * constructor, and in a single-page app a meta tag is document-global and
 * outlives the component that wrote it. So a visitor who landed on `/` and
 * clicked through to `/dashboard` was serving `index, follow` on an
 * authenticated view. `robots.txt` disallows those paths, but a crawler that
 * reaches one another way — a shared link, an embedded preview — reads the tag.
 *
 * Fixed structurally rather than per page: indexability is a property of the
 * route, declared in `data.robots`, and this applies it on every navigation.
 * A new route inherits `noindex` by default, which is the safe direction to be
 * wrong in — the cost of missing an index is a page not found by search, the
 * cost of the reverse is leaking an authenticated surface.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);

  private started = false;

  /** Safe to call more than once; the app shell calls it on boot. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.apply(this.robotsForCurrentRoute());
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.apply(this.robotsForCurrentRoute()));
  }

  private apply(directive: RobotsDirective): void {
    this.meta.updateTag({ name: 'robots', content: directive });
  }

  /** The deepest matched route wins, so a child can tighten a parent's default. */
  private robotsForCurrentRoute(): RobotsDirective {
    let route = this.router.routerState.root;
    let directive: RobotsDirective = NOT_INDEXABLE;

    while (route) {
      const data = route.snapshot.data as SeoRouteData;
      if (data.robots) directive = data.robots;
      if (!route.firstChild) break;
      route = route.firstChild;
    }

    return directive;
  }
}
