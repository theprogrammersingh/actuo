import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type InputType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';

let nextId = 0;

/**
 * Labelled text field with hint, error and a reveal toggle for masked values.
 *
 * Two ways to bind, both supported:
 *
 * ```html
 * <ui-input label="Merchant" [(value)]="merchant" />
 * <ui-input label="Gemini API key" type="password" formControlName="geminiKey" />
 * ```
 *
 * The BYOK key field (Design Doc §3.3) is the reason `type="password"` grows a
 * show/hide toggle: a key you cannot read back is a key you cannot verify.
 */
@Component({
  selector: 'ui-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Input),
      multi: true,
    },
  ],
  template: `
    <label [attr.for]="controlId()" class="mb-1.5 block text-sm font-medium text-body">
      {{ label() }}
      @if (required()) {
        <span class="text-status-danger" aria-hidden="true">*</span>
      }
    </label>

    <div class="relative">
      <input
        [attr.id]="controlId()"
        [attr.name]="name()"
        [attr.type]="resolvedType()"
        [attr.placeholder]="placeholder()"
        [attr.autocomplete]="autocomplete()"
        [attr.inputmode]="inputmode()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-required]="required() ? 'true' : null"
        [value]="value()"
        [disabled]="isDisabled()"
        [readOnly]="readonly()"
        [class]="fieldClass()"
        (input)="handleInput($event)"
        (blur)="handleBlur()"
      />

      @if (revealable()) {
        <button
          type="button"
          class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg
                 text-muted transition-colors duration-150 ease-out hover:text-body
                 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-teal
                 disabled:cursor-not-allowed disabled:opacity-50"
          [disabled]="isDisabled()"
          [attr.aria-label]="revealed() ? 'Hide ' + label() : 'Show ' + label()"
          [attr.aria-pressed]="revealed()"
          (click)="toggleReveal()"
        >
          @if (revealed()) {
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.4 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.2 3.1" />
              <path d="M6.2 6.9C4 8.4 3 10.6 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 3.6-.7" />
            </svg>
          } @else {
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          }
        </button>
      }
    </div>

    @if (error()) {
      <p [attr.id]="errorId()" class="mt-1.5 text-xs text-status-danger" role="alert">
        {{ error() }}
      </p>
    } @else if (hint()) {
      <p [attr.id]="hintId()" class="mt-1.5 text-xs text-muted">{{ hint() }}</p>
    }
  `,
})
export class Input implements ControlValueAccessor {
  private readonly uid = `ui-input-${nextId++}`;

  readonly label = input.required<string>();
  readonly type = input<InputType>('text');
  readonly hint = input<string | null>(null);
  /** Present error means the field is invalid; it replaces the hint. */
  readonly error = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly inputmode = input<string | null>(null);
  readonly name = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Explicit id, if the caller needs to point something else at this field. */
  readonly id = input<string | null>(null);
  /** Two-way binding for the template-driven case. */
  readonly value = model<string>('');

  /** Set only by `setDisabledState` from a reactive form. */
  private readonly formDisabled = signal(false);
  protected readonly revealed = signal(false);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  protected readonly controlId = computed(() => this.id() ?? this.uid);
  protected readonly hintId = computed(() => `${this.controlId()}-hint`);
  protected readonly errorId = computed(() => `${this.controlId()}-error`);

  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly revealable = computed(() => this.type() === 'password');

  /** Revealing a masked field swaps to `text` so the browser renders glyphs. */
  protected readonly resolvedType = computed(() =>
    this.revealable() && this.revealed() ? 'text' : this.type(),
  );

  protected readonly describedBy = computed(() => {
    if (this.error()) return this.errorId();
    if (this.hint()) return this.hintId();
    return null;
  });

  protected readonly fieldClass = computed(() =>
    [
      // 44px minimum touch target (§3.7).
      'block min-h-11 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-body',
      'placeholder:text-muted transition-colors duration-150 ease-out',
      'focus-visible:outline-2 focus-visible:-outline-offset-1',
      'disabled:cursor-not-allowed disabled:opacity-50 read-only:text-muted',
      this.error()
        ? 'border-status-danger focus-visible:outline-status-danger'
        : 'border-line focus-visible:outline-brand-teal',
      // Room for the reveal button so long keys never sit under it.
      this.revealable() ? 'pr-11' : '',
      // Keys and other secrets read better in mono.
      this.type() === 'password' ? 'font-mono' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  protected handleInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  protected handleBlur(): void {
    this.onTouched();
  }

  protected toggleReveal(): void {
    this.revealed.update((revealed) => !revealed);
  }

  // --- ControlValueAccessor -------------------------------------------------

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
