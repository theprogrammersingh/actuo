import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Designed empty state — Design Doc §3.6: never a bare "No data". The copy has
 * to name the action that would fill the list, which is why `message` is
 * required rather than optional.
 *
 * ```html
 * <ui-empty-state
 *   heading="No expenses yet"
 *   message="Add one, or ask the Copilot to log something for you."
 * >
 *   <svg uiEmptyIcon …></svg>
 *   <button uiButton uiEmptyAction>Add expense</button>
 * </ui-empty-state>
 * ```
 */
@Component({
  selector: 'ui-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col items-center justify-center rounded-xl border border-dashed
             border-line bg-surface px-6 py-10 text-center sm:py-14"
    >
      <!--
        A single muted accent shape rather than stock illustration (§2.4).
        Deliberately not the aurora gradient: empty states are common, and the
        gradient is scarce.
      -->
      <div
        class="mb-4 flex size-11 items-center justify-center rounded-full border border-line
               bg-card text-muted"
        aria-hidden="true"
      >
        <ng-content select="[uiEmptyIcon]">
          <svg
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            focusable="false"
          >
            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" />
            <path d="M8 12h8" />
          </svg>
        </ng-content>
      </div>

      @switch (headingLevel()) {
        @case (2) {
          <h2 class="text-base font-semibold text-body">{{ heading() }}</h2>
        }
        @case (4) {
          <h4 class="text-base font-semibold text-body">{{ heading() }}</h4>
        }
        @default {
          <h3 class="text-base font-semibold text-body">{{ heading() }}</h3>
        }
      }

      <p class="mt-1.5 max-w-sm text-sm text-muted">{{ message() }}</p>

      <div class="mt-5 flex flex-wrap items-center justify-center gap-2 empty:hidden">
        <ng-content select="[uiEmptyAction]" />
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly heading = input.required<string>();
  /** Specific copy tied to the action that would fill this view (§3.6). */
  readonly message = input.required<string>();
  /** Match the surrounding document outline. */
  readonly headingLevel = input<2 | 3 | 4>(3);
}
