import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

export type ProgressTone = 'auto' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Resolved tones only — `auto` is never a paint value. */
type PaintTone = Exclude<ProgressTone, 'auto'>;

const TRACK = 'w-full overflow-hidden rounded-full bg-line';

const FILL: Record<PaintTone, string> = {
  neutral: 'bg-muted',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
  info: 'bg-status-info',
};

const VALUE_TEXT: Record<PaintTone, string> = {
  neutral: 'text-muted',
  success: 'text-body',
  warning: 'text-body',
  danger: 'text-status-danger',
  info: 'text-body',
};

/**
 * Budget utilisation bar — Design Doc §3.3: colour shifts
 * `status.success → status.warning → status.danger` as usage climbs.
 *
 * ```html
 * <ui-progress-bar label="Travel" [value]="spent" [max]="budget" />
 * ```
 */
@Component({
  selector: 'ui-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (label() || showValue()) {
      <div class="mb-1.5 flex items-baseline justify-between gap-3">
        @if (label()) {
          <span class="text-sm font-medium text-body">{{ label() }}</span>
        }
        @if (showValue()) {
          <span class="tabular text-xs font-medium" [class]="valueTextClass()" data-money>
            {{ valueText() }}
          </span>
        }
      </div>
    }
    <div
      [class]="trackClass()"
      role="progressbar"
      [attr.aria-valuenow]="roundedPercent()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuetext]="valueText()"
      [attr.aria-label]="label() ? null : ariaLabel()"
      [attr.aria-labelledby]="null"
    >
      <div
        class="h-full rounded-full transition-[width] duration-200 ease-out"
        [class]="fillClass()"
        [style.width.%]="clampedPercent()"
      ></div>
    </div>
    @if (overBudget()) {
      <p class="mt-1.5 text-xs text-status-danger">{{ overBudgetText() }}</p>
    }
  `,
})
export class ProgressBar {
  readonly value = input.required<number>();
  readonly max = input(100, { transform: numberAttribute });
  readonly label = input<string | null>(null);
  /** Fallback accessible name when there is no visible label. */
  readonly ariaLabel = input('Progress');
  readonly showValue = input(true, { transform: booleanAttribute });
  /** Percentage at which the ramp moves success → warning. */
  readonly warnAt = input(75, { transform: numberAttribute });
  /** Percentage at which the ramp moves warning → danger. */
  readonly dangerAt = input(90, { transform: numberAttribute });
  /** `auto` runs the threshold ramp; anything else pins the colour. */
  readonly tone = input<ProgressTone>('auto');
  readonly size = input<'sm' | 'md'>('md');

  /** Raw utilisation — may exceed 100 when over budget. */
  readonly percent = computed(() => {
    const max = this.max();
    if (!Number.isFinite(max) || max <= 0) return 0;
    const raw = (this.value() / max) * 100;
    return Number.isFinite(raw) ? Math.max(raw, 0) : 0;
  });

  /** What the bar actually paints — never past the end of the track. */
  protected readonly clampedPercent = computed(() => Math.min(this.percent(), 100));
  protected readonly roundedPercent = computed(() => Math.round(this.clampedPercent()));

  readonly overBudget = computed(() => this.percent() > 100);

  /**
   * The ramp. Crossing 100% stays `danger` — there is no tone above it, and an
   * over-budget bar must not read as merely "warning".
   */
  readonly paintTone = computed<PaintTone>(() => {
    const pinned = this.tone();
    if (pinned !== 'auto') return pinned;
    const percent = this.percent();
    if (percent >= this.dangerAt()) return 'danger';
    if (percent >= this.warnAt()) return 'warning';
    return 'success';
  });

  protected readonly trackClass = computed(() =>
    [TRACK, this.size() === 'sm' ? 'h-1.5' : 'h-2.5'].join(' '),
  );
  protected readonly fillClass = computed(() => FILL[this.paintTone()]);
  protected readonly valueTextClass = computed(() => VALUE_TEXT[this.paintTone()]);

  protected readonly valueText = computed(() => `${Math.round(this.percent())}%`);
  protected readonly overBudgetText = computed(
    () => `Over by ${Math.round(this.percent() - 100)}%`,
  );
}
