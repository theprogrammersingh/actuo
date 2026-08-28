import { ChangeDetectionStrategy, Component, computed, input, numberAttribute } from '@angular/core';

export type SkeletonShape = 'text' | 'list' | 'table' | 'card' | 'circle' | 'block';

/** Shimmer bar. One string so every placeholder pulses identically. */
const BAR = 'animate-pulse rounded bg-line';

/**
 * Loading placeholder. Design Doc §3.6: list-shaped things get skeletons, never
 * spinners, so the layout does not jump when data lands.
 *
 * ```html
 * @if (loading()) { <ui-skeleton shape="table" [rows]="6" [columns]="5" label="Loading expenses" /> }
 * ```
 *
 * The boxes are `aria-hidden`; the accessible signal is the `role="status"` host
 * plus one polite message, so a screen reader hears "Loading expenses" once
 * rather than a burst of empty nodes. `animate-pulse` is already neutralised by
 * the global `prefers-reduced-motion` rule in styles.css.
 */
@Component({
  selector: 'ui-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    role: 'status',
    'aria-busy': 'true',
    'aria-live': 'polite',
  },
  template: `
    <span class="sr-only">{{ label() }}</span>

    <div aria-hidden="true">
      @switch (shape()) {
        @case ('text') {
          <div class="space-y-2">
            @for (line of lineList(); track line.index) {
              <div class="animate-pulse rounded bg-line h-4" [style.width]="line.width"></div>
            }
          </div>
        }

        @case ('list') {
          <ul class="divide-y divide-line">
            @for (row of lineList(); track row.index) {
              <li class="flex items-center gap-3 py-3">
                <div class="animate-pulse rounded-full bg-line size-9 shrink-0"></div>
                <div class="min-w-0 flex-1 space-y-2">
                  <div class="animate-pulse rounded bg-line h-4 w-1/3"></div>
                  <div class="animate-pulse rounded bg-line h-3 w-1/2"></div>
                </div>
                <div class="animate-pulse rounded bg-line h-4 w-16 shrink-0"></div>
              </li>
            }
          </ul>
        }

        @case ('table') {
          <div class="overflow-hidden rounded-xl border border-line">
            <div class="flex gap-4 border-b border-line bg-surface px-4 py-3">
              @for (column of columnList(); track column) {
                <div class="animate-pulse rounded bg-line h-3 flex-1"></div>
              }
            </div>
            @for (row of rowList(); track row) {
              <div class="flex gap-4 border-b border-line px-4 py-3 last:border-b-0">
                @for (column of columnList(); track column) {
                  <div class="animate-pulse rounded bg-line h-4 flex-1"></div>
                }
              </div>
            }
          </div>
        }

        @case ('card') {
          <div class="rounded-xl border border-line bg-card p-4 sm:p-5">
            <div class="animate-pulse rounded bg-line h-3 w-24"></div>
            <div class="animate-pulse rounded bg-line mt-3 h-7 w-40"></div>
            <div class="animate-pulse rounded bg-line mt-3 h-3 w-32"></div>
          </div>
        }

        @case ('circle') {
          <div
            class="animate-pulse rounded-full bg-line"
            [style.width]="width()"
            [style.height]="width()"
          ></div>
        }

        @default {
          <div
            class="animate-pulse rounded bg-line"
            [style.width]="width()"
            [style.height]="height()"
          ></div>
        }
      }
    </div>
  `,
})
export class Skeleton {
  readonly shape = input<SkeletonShape>('text');
  /** Rows for `text` / `list`. */
  readonly lines = input(3, { transform: numberAttribute });
  /** Body rows for `table`. */
  readonly rows = input(5, { transform: numberAttribute });
  /** Columns for `table`. */
  readonly columns = input(4, { transform: numberAttribute });
  /** CSS length for `block` (and the diameter for `circle`). */
  readonly width = input('100%');
  readonly height = input('1rem');
  /** Announced politely while loading. Make it specific — "Loading expenses". */
  readonly label = input('Loading');

  /** Last text line is short, which is what makes a skeleton read as prose. */
  protected readonly lineList = computed(() => {
    const count = Math.max(1, this.lines());
    return Array.from({ length: count }, (_, index) => ({
      index,
      width: index === count - 1 ? '65%' : '100%',
    }));
  });

  protected readonly rowList = computed(() =>
    Array.from({ length: Math.max(1, this.rows()) }, (_, index) => index),
  );

  protected readonly columnList = computed(() =>
    Array.from({ length: Math.max(1, this.columns()) }, (_, index) => index),
  );

  /** Exposed for tests/consumers that want the same shimmer on a bespoke shape. */
  static readonly barClass = BAR;
}
