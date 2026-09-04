import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { APP_DESTINATIONS, NAVIGATE_TO, type AppDestination } from '@actuo/shared';
import type { ActuoTool } from '../webmcp/tool-registry.js';

/**
 * The navigation tool (PRD §7).
 *
 * Separate from `ExpenseTools` on purpose: every tool there is an HTTP call to
 * `/api/*`, and this one touches the `Router` and nothing else. Mixing them
 * would drag routing into the spec of a file that tests cleanly with a fake
 * `ApiClient` and no router at all.
 */
@Injectable({ providedIn: 'root' })
export class NavigationTools {
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  navigateTo(): ActuoTool<{ destination: string }> {
    return {
      contract: NAVIGATE_TO,
      execute: async ({ destination }) => {
        /*
         * Resolve through the table; the model's string never reaches the
         * router. `navigateByUrl` would happily take an arbitrary path, and an
         * enum in a JSON Schema is a hint to the model, not a guarantee about
         * what arrives — a mistyped or hallucinated value has to fail here
         * rather than navigating somewhere nobody described.
         */
        const target = findDestination(destination);
        if (!target) {
          throw new Error(
            `Unknown destination "${destination}". Valid destinations are: ` +
              `${APP_DESTINATIONS.map((d) => d.id).join(', ')}.`,
          );
        }

        // Defensive: tools only publish once signed in, which is browser-only.
        if (!this.isBrowser) {
          throw new Error('Navigation is only available in the browser.');
        }

        await this.router.navigateByUrl(target.path);

        /*
         * Report where the browser actually is, not where it was told to go.
         * A guard can redirect — an expired session lands on `/login` — and the
         * boolean `navigateByUrl` resolves does not distinguish "blocked" from
         * "redirected somewhere else" reliably. Reading the router back is the
         * only answer that cannot be wrong, and a model told it reached the
         * budgets page when the user is staring at a login form will keep
         * building on that mistake.
         */
        const landedOn = stripQuery(this.router.url);
        const redirected = landedOn !== target.path;

        return {
          destination: target.id,
          path: landedOn,
          description: redirected ? undefined : target.description,
          redirected,
          ...(redirected
            ? { note: `Navigation to ${target.path} was redirected to ${landedOn}.` }
            : {}),
        };
      },
    };
  }

  /** Everything this service publishes. Mirrors `ExpenseTools.all()`. */
  all(): ActuoTool<never>[] {
    return [this.navigateTo()] as unknown as ActuoTool<never>[];
  }
}

function findDestination(id: unknown): AppDestination | undefined {
  return APP_DESTINATIONS.find((d) => d.id === id);
}

/** `Router.url` carries query and fragment; destinations are bare paths. */
function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}
