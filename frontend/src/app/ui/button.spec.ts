import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Button, type ButtonSize, type ButtonVariant } from './button';

@Component({
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      uiButton
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      [loading]="loading()"
      [block]="block()"
      (click)="clicks.set(clicks() + 1)"
    >
      Submit expense
    </button>
  `,
})
class Host {
  readonly variant = signal<ButtonVariant>('primary');
  readonly size = signal<ButtonSize>('md');
  readonly disabled = signal(false);
  readonly loading = signal(false);
  readonly block = signal(false);
  readonly clicks = signal(0);
}

describe('Button', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const el = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders projected content on a real <button>', () => {
    expect(el().tagName).toBe('BUTTON');
    expect(el().textContent?.trim()).toContain('Submit expense');
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    expect(el().getAttribute('type')).toBe('button');
  });

  it.each<[ButtonVariant, string]>([
    ['primary', 'bg-brand-teal'],
    ['secondary', 'bg-card'],
    ['ghost', 'bg-transparent'],
    ['danger', 'bg-status-danger'],
  ])('paints the %s variant', (variant, expected) => {
    host.variant.set(variant);
    fixture.detectChanges();
    expect(el().className).toContain(expected);
  });

  it.each<ButtonSize>(['sm', 'md', 'lg'])(
    'keeps the %s size at or above the 44px touch target (§3.7)',
    (size) => {
      host.size.set(size);
      fixture.detectChanges();
      // min-h-11 = 2.75rem = 44px; min-h-12 = 3rem = 48px.
      expect(el().className).toMatch(/min-h-1[12]\b/);
    },
  );

  describe('disabled', () => {
    beforeEach(() => {
      host.disabled.set(true);
      fixture.detectChanges();
    });

    it('sets the native disabled property', () => {
      expect(el().disabled).toBe(true);
    });

    it('does not emit clicks', () => {
      el().click();
      expect(host.clicks()).toBe(0);
    });

    it('is not marked busy — disabled is not loading', () => {
      expect(el().getAttribute('aria-busy')).toBeNull();
    });
  });

  describe('loading', () => {
    beforeEach(() => {
      host.loading.set(true);
      fixture.detectChanges();
    });

    it('disables the button so it cannot be double-submitted', () => {
      expect(el().disabled).toBe(true);
    });

    it('announces itself as busy', () => {
      expect(el().getAttribute('aria-busy')).toBe('true');
    });

    it('renders a spinner that is hidden from assistive tech', () => {
      const spinner = el().querySelector('svg');
      expect(spinner).not.toBeNull();
      expect(spinner?.getAttribute('aria-hidden')).toBe('true');
      expect(spinner?.getAttribute('class')).toContain('animate-spin');
    });

    it('exposes a screen-reader-only status label instead', () => {
      expect(el().querySelector('.sr-only')?.textContent?.trim()).toBe('Loading');
    });

    it('swallows clicks while in flight', () => {
      el().click();
      expect(host.clicks()).toBe(0);
    });

    it('drops the spinner and re-enables when loading ends', () => {
      host.loading.set(false);
      fixture.detectChanges();

      expect(el().disabled).toBe(false);
      expect(el().querySelector('svg')).toBeNull();

      el().click();
      expect(host.clicks()).toBe(1);
    });
  });

  it('emits clicks when idle', () => {
    el().click();
    expect(host.clicks()).toBe(1);
  });

  it('stretches to full width when block is set', () => {
    expect(el().className).not.toContain('w-full');
    host.block.set(true);
    fixture.detectChanges();
    expect(el().className).toContain('w-full');
  });
});
