import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Base chrome shared by every variant.
 *
 * §3.7 — every size clears the 44px touch target via `min-h-11`; sizes differ in
 * horizontal padding and type scale, never by shrinking below the target.
 * §3.4 — 150ms colour transition, nothing decorative.
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium leading-none ' +
  'transition-colors duration-150 ease-out ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Deliberately no `bg-aurora` here. §2.2 keeps the gradient scarce — Copilot orb,
 * its thinking state, primary onboarding, chart accents — so the primary CTA is a
 * flat brand accent instead.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-teal text-ink-inverted hover:bg-brand-teal/90 active:bg-brand-teal/80 ' +
    'focus-visible:outline-brand-teal',
  secondary:
    'border border-line bg-card text-body hover:bg-line/50 active:bg-line/70 ' +
    'focus-visible:outline-brand-teal',
  ghost: 'bg-transparent text-body hover:bg-card active:bg-line/50 focus-visible:outline-brand-teal',
  // status.danger signals a destructive state, which is state — not decoration.
  danger:
    'bg-status-danger text-ink-inverted hover:bg-status-danger/90 active:bg-status-danger/80 ' +
    'focus-visible:outline-status-danger',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-xs',
  md: 'min-h-11 px-4 py-2 text-sm',
  lg: 'min-h-12 px-6 py-3 text-base',
};

/**
 * Attribute-selector component so the host stays a real `<button>`: native
 * disabled semantics, native focus order, native form submission.
 *
 * ```html
 * <button uiButton variant="primary" size="md" [loading]="saving()">Save</button>
 * ```
 */
@Component({
  selector: 'button[uiButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    '[disabled]': 'isDisabled()',
    '[attr.type]': 'type()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    @if (loading()) {
      <svg
        class="size-4 shrink-0 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          class="opacity-30"
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          stroke-width="3"
        ></circle>
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
        ></path>
      </svg>
      <span class="sr-only">{{ loadingLabel() }}</span>
    }
    <ng-content />
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  /** Announced to screen readers while `loading` is true. */
  readonly loadingLabel = input('Loading');
  /** Stretch to the width of the container — useful on mobile. */
  readonly block = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null);

  /** A loading button is inert: it must not be double-submitted. */
  protected readonly isDisabled = computed(() => this.disabled() || this.loading());

  protected readonly hostClass = computed(() =>
    [BASE, VARIANTS[this.variant()], SIZES[this.size()], this.block() ? 'w-full' : '']
      .filter(Boolean)
      .join(' '),
  );
}
