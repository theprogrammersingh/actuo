import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

/**
 * The colour a delta is painted in.
 *
 * Defaults to `neutral` on purpose. In an expense tool "spend up 12%" is not
 * good news, and §2.2 forbids using `status.*` where it does not genuinely
 * signal state — so the caller decides, rather than the sign of the number.
 */
export type DeltaTone = 'neutral' | 'positive' | 'negative';

const DELTA_CLASS: Record<DeltaTone, string> = {
  neutral: 'text-muted',
  positive: 'text-status-success',
  negative: 'text-status-danger',
};

/**
 * Dashboard summary tile — label, one big tabular number, optional delta.
 *
 * ```html
 * <ui-stat-card label="This month" value="₹1,24,500" [delta]="-4.2" deltaLabel="vs last month" />
 * <ui-stat-card label="Spend pace" value="On track" aurora />
 * ```
 *
 * `aurora` is the Design Doc §3.3 hero treatment and is scarce by rule (§2.2):
 * **at most one aurora stat card per viewport.** It paints a gradient ring, not
 * gradient text — clipped-gradient text drops below AA on the light theme.
 */
@Component({
  selector: 'ui-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="shellClass()">
      <div [class]="bodyClass()">
        <p class="text-xs font-medium tracking-wide text-muted uppercase">{{ label() }}</p>

        <p
          class="mt-2 text-2xl leading-tight font-semibold text-body sm:text-3xl"
          [class.tabular]="money()"
          [attr.data-money]="money() ? '' : null"
        >
          {{ value() }}
        </p>

        @if (delta() !== null) {
          <p class="mt-2 flex items-baseline gap-1.5 text-xs">
            <span [class]="deltaClass()">
              <span aria-hidden="true">{{ deltaArrow() }}</span>
              <span class="tabular">{{ deltaText() }}</span>
            </span>
            @if (deltaLabel()) {
              <span class="text-muted">{{ deltaLabel() }}</span>
            }
          </p>
        }

        @if (hint()) {
          <p class="mt-2 text-xs text-muted">{{ hint() }}</p>
        }

        <ng-content />
      </div>
    </div>
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  /** Pre-formatted for display — this component does no currency logic. */
  readonly value = input.required<string>();
  /** Percentage change. Null hides the delta row entirely. */
  readonly delta = input<number | null>(null);
  /** Context for the delta, e.g. "vs last month". */
  readonly deltaLabel = input<string | null>(null);
  /** Colour of the delta. Neutral unless the caller says the direction matters. */
  readonly deltaTone = input<DeltaTone>('neutral');
  readonly hint = input<string | null>(null);
  /** Applies tabular numerals + `data-money`. On by default; turn off for text values. */
  readonly money = input(true, { transform: booleanAttribute });
  /** The single hero card. Never more than one per viewport. */
  readonly aurora = input(false, { transform: booleanAttribute });

  protected readonly shellClass = computed(() =>
    this.aurora()
      ? 'rounded-xl bg-aurora p-px shadow-glow-violet'
      : 'rounded-xl border border-line bg-card',
  );

  /** With the gradient ring the inner radius has to sit 1px inside the outer one. */
  protected readonly bodyClass = computed(() =>
    this.aurora() ? 'rounded-[11px] bg-card p-4 sm:p-5' : 'p-4 sm:p-5',
  );

  protected readonly deltaClass = computed(() => DELTA_CLASS[this.deltaTone()]);

  /** Direction is shape (arrow), tone is colour — they are set independently. */
  protected readonly deltaArrow = computed(() => {
    const delta = this.delta();
    if (delta === null || delta === 0) return '→';
    return delta > 0 ? '↑' : '↓';
  });

  protected readonly deltaText = computed(() => {
    const delta = this.delta();
    if (delta === null) return '';
    return `${Math.abs(delta)}%`;
  });
}
