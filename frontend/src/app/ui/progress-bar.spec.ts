import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  let fixture: ComponentFixture<ProgressBar>;

  const bar = () => fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement;
  const fill = () => bar().firstElementChild as HTMLElement;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProgressBar] }).compileComponents();
    fixture = TestBed.createComponent(ProgressBar);
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
  });

  describe('threshold ramp (§3.3)', () => {
    // Defaults: warnAt 75, dangerAt 90.
    it.each([
      [0, 'success'],
      [42, 'success'],
      [74.9, 'success'],
      [75, 'warning'],
      [89.9, 'warning'],
      [90, 'danger'],
      [100, 'danger'],
      [140, 'danger'],
    ])('paints %d%% as %s', (value, tone) => {
      set({ value });
      expect(fixture.componentInstance.paintTone()).toBe(tone);
    });

    it('ramps on percentage, not on the raw value', () => {
      set({ value: 80, max: 200 }); // 40%
      expect(fixture.componentInstance.paintTone()).toBe('success');

      set({ value: 190, max: 200 }); // 95%
      expect(fixture.componentInstance.paintTone()).toBe('danger');
    });

    it('honours custom thresholds', () => {
      set({ value: 60, warnAt: 50, dangerAt: 55 });
      expect(fixture.componentInstance.paintTone()).toBe('danger');
    });

    it('applies the matching status utility to the fill', () => {
      set({ value: 30 });
      expect(fill().className).toContain('bg-status-success');

      set({ value: 80 });
      expect(fill().className).toContain('bg-status-warning');

      set({ value: 95 });
      expect(fill().className).toContain('bg-status-danger');
    });

    it('a pinned tone opts out of the ramp entirely', () => {
      set({ value: 99, tone: 'info' });
      expect(fixture.componentInstance.paintTone()).toBe('info');
      expect(fill().className).toContain('bg-status-info');
    });
  });

  describe('geometry', () => {
    it('renders the fill at the utilisation percentage', () => {
      set({ value: 25, max: 50 });
      expect(fill().style.width).toBe('50%');
    });

    it('clamps the painted width at 100% when over budget', () => {
      set({ value: 150 });
      expect(fill().style.width).toBe('100%');
      expect(fixture.componentInstance.percent()).toBe(150);
    });

    it('clamps negatives to zero rather than painting backwards', () => {
      set({ value: -20 });
      expect(fill().style.width).toBe('0%');
    });

    it('degrades to 0% instead of NaN when max is zero', () => {
      set({ value: 10, max: 0 });
      expect(fixture.componentInstance.percent()).toBe(0);
      expect(fill().style.width).toBe('0%');
    });
  });

  describe('over budget', () => {
    it('flags the overage explicitly', () => {
      set({ value: 118 });
      expect(fixture.componentInstance.overBudget()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Over by 18%');
    });

    it('says nothing when inside budget', () => {
      set({ value: 99 });
      expect(fixture.componentInstance.overBudget()).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Over by');
    });
  });

  describe('accessibility', () => {
    it('exposes clamped progressbar values', () => {
      set({ value: 130 });
      expect(bar().getAttribute('aria-valuenow')).toBe('100');
      expect(bar().getAttribute('aria-valuemin')).toBe('0');
      expect(bar().getAttribute('aria-valuemax')).toBe('100');
    });

    it('uses the visible label as the accessible name when there is one', () => {
      set({ value: 40, label: 'Travel' });
      expect(fixture.nativeElement.textContent).toContain('Travel');
      expect(bar().getAttribute('aria-label')).toBeNull();
    });

    it('falls back to ariaLabel when there is no visible label', () => {
      set({ value: 40, ariaLabel: 'Report generation' });
      expect(bar().getAttribute('aria-label')).toBe('Report generation');
    });

    it('reports the true percentage in aria-valuetext, even over budget', () => {
      set({ value: 130 });
      expect(bar().getAttribute('aria-valuetext')).toBe('130%');
    });
  });

  it('shows tabular numerals on the value readout', () => {
    set({ value: 42 });
    const readout = fixture.nativeElement.querySelector('[data-money]') as HTMLElement;
    expect(readout.className).toContain('tabular');
    expect(readout.textContent?.trim()).toBe('42%');
  });

  it('can hide the value readout', () => {
    set({ value: 42, showValue: false });
    expect(fixture.nativeElement.querySelector('[data-money]')).toBeNull();
  });
});
