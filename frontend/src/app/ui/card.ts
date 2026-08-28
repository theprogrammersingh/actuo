import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-6 sm:p-8',
};

/**
 * The surface everything else sits on. Semantic tokens only, so light mode is
 * handled entirely by the `:root[data-theme='light']` override in styles.css.
 *
 * ```html
 * <ui-card>
 *   <h3 uiCardHeader>Budget</h3>
 *   …
 *   <div uiCardFooter>…</div>
 * </ui-card>
 * ```
 */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
  template: `
    <ng-content select="[uiCardHeader]" />
    <ng-content />
    <ng-content select="[uiCardFooter]" />
  `,
})
export class Card {
  readonly padding = input<CardPadding>('md');
  /** Adds hover affordance — only for cards that are themselves clickable. */
  readonly interactive = input(false, { transform: booleanAttribute });
  /** Drops the border for cards nested inside another bordered surface. */
  readonly flush = input(false, { transform: booleanAttribute });

  protected readonly hostClass = computed(() =>
    [
      'block rounded-xl bg-card',
      this.flush() ? '' : 'border border-line',
      PADDING[this.padding()],
      this.interactive()
        ? 'cursor-pointer transition-colors duration-150 ease-out hover:border-brand-teal/40 ' +
          'focus-within:border-brand-teal/60'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
