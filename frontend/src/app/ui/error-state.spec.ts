import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ErrorState } from './error-state';

describe('ErrorState', () => {
  let fixture: ComponentFixture<ErrorState>;
  const host = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(host().querySelectorAll('button')) as HTMLButtonElement[];
  const byText = (text: string) =>
    buttons().find((button) => button.textContent?.includes(text)) ?? null;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ErrorState] }).compileComponents();
    fixture = TestBed.createComponent(ErrorState);
    fixture.detectChanges();
  });

  it('announces itself as an alert', () => {
    expect(host().querySelector('[role="alert"]')).not.toBeNull();
  });

  describe('default copy (§3.6 — never blame the user)', () => {
    const blaming = [
      /\byou\b/i,
      /\byour\b/i,
      /invalid input/i,
      /\bfailed to\b.*\byou\b/i,
      /incorrect/i,
    ];

    it('does not address or fault the user', () => {
      const copy = host().textContent ?? '';
      for (const pattern of blaming) {
        expect(copy).not.toMatch(pattern);
      }
    });

    it('reassures that nothing was changed', () => {
      expect(host().textContent).toContain('Nothing was changed');
    });

    it('offers an action', () => {
      expect(byText('Try again')).not.toBeNull();
    });
  });

  describe('retry', () => {
    it('emits on click', () => {
      let count = 0;
      fixture.componentInstance.retry.subscribe(() => count++);

      byText('Try again')!.click();
      byText('Try again')!.click();

      expect(count).toBe(2);
    });

    it('takes a custom label', () => {
      set({ retryLabel: 'Reload expenses' });
      expect(byText('Reload expenses')).not.toBeNull();
    });

    it('can be suppressed when there is nothing to retry', () => {
      set({ showRetry: false });
      expect(byText('Try again')).toBeNull();
    });
  });

  describe('technical detail', () => {
    it('is absent unless supplied', () => {
      expect(byText('Show details')).toBeNull();
    });

    it('stays collapsed so the primary read is what to do next', () => {
      set({ detail: 'GET /api/expenses — 503 Service Unavailable' });

      const disclosure = byText('Show details')!;
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(host().querySelector('pre')).toBeNull();
    });

    it('expands and collapses on demand', () => {
      set({ detail: 'GET /api/expenses — 503 Service Unavailable' });

      byText('Show details')!.click();
      fixture.detectChanges();

      expect(host().querySelector('pre')?.textContent).toContain('503 Service Unavailable');
      expect(byText('Hide details')!.getAttribute('aria-expanded')).toBe('true');

      byText('Hide details')!.click();
      fixture.detectChanges();

      expect(host().querySelector('pre')).toBeNull();
    });
  });

  it('accepts overridden copy', () => {
    set({
      heading: 'The Copilot lost its connection',
      message: 'The request was cut short. Nothing was changed — reconnect and retry.',
    });

    expect(host().textContent).toContain('The Copilot lost its connection');
  });
});
