import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatCard } from './stat-card';

describe('StatCard', () => {
  let fixture: ComponentFixture<StatCard>;

  const shell = () => fixture.nativeElement.firstElementChild as HTMLElement;
  const value = () => fixture.nativeElement.querySelector('[data-money]') as HTMLElement | null;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, val] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, val);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatCard] }).compileComponents();
    fixture = TestBed.createComponent(StatCard);
    fixture.componentRef.setInput('label', 'This month');
    fixture.componentRef.setInput('value', '₹1,24,500');
    fixture.detectChanges();
  });

  it('renders the label and the value', () => {
    expect(fixture.nativeElement.textContent).toContain('This month');
    expect(fixture.nativeElement.textContent).toContain('₹1,24,500');
  });

  describe('money formatting (§2.3)', () => {
    it('marks the value as money with tabular numerals by default', () => {
      expect(value()).not.toBeNull();
      expect(value()!.className).toContain('tabular');
    });

    it('drops both for non-money values', () => {
      set({ money: false, value: '7' });
      expect(value()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('7');
    });
  });

  describe('delta', () => {
    it('is absent by default', () => {
      expect(fixture.nativeElement.textContent).not.toContain('%');
    });

    it('shows an up arrow and the magnitude for a rise', () => {
      set({ delta: 12.5 });
      expect(fixture.nativeElement.textContent).toContain('↑');
      expect(fixture.nativeElement.textContent).toContain('12.5%');
    });

    it('shows a down arrow and drops the sign for a fall', () => {
      set({ delta: -4.2 });
      expect(fixture.nativeElement.textContent).toContain('↓');
      expect(fixture.nativeElement.textContent).toContain('4.2%');
      expect(fixture.nativeElement.textContent).not.toContain('-4.2');
    });

    it('shows a flat arrow at zero', () => {
      set({ delta: 0 });
      expect(fixture.nativeElement.textContent).toContain('→');
    });

    it('stays neutral by default — a rise in spend is not good news', () => {
      set({ delta: 12 });
      const el = fixture.nativeElement.querySelector('span.text-muted, span.text-status-success');
      expect(el?.className).toContain('text-muted');
    });

    it('takes a status colour only when the caller says direction matters', () => {
      set({ delta: -4.2, deltaTone: 'positive' });
      expect(fixture.nativeElement.innerHTML).toContain('text-status-success');

      set({ deltaTone: 'negative' });
      expect(fixture.nativeElement.innerHTML).toContain('text-status-danger');
    });

    it('renders the delta context label', () => {
      set({ delta: 3, deltaLabel: 'vs last month' });
      expect(fixture.nativeElement.textContent).toContain('vs last month');
    });
  });

  describe('aurora hero treatment (§2.2 scarcity)', () => {
    it('is off by default — an ordinary card gets an ordinary border', () => {
      expect(shell().className).toContain('border-line');
      expect(shell().className).not.toContain('bg-aurora');
    });

    it('paints a gradient ring when enabled', () => {
      set({ aurora: true });
      expect(shell().className).toContain('bg-aurora');
      expect(shell().className).not.toContain('border-line');
    });

    it('keeps the value in body text, not clipped-gradient text', () => {
      // Gradient text drops below AA on the light theme; the ring carries the accent.
      set({ aurora: true });
      expect(value()!.className).toContain('text-body');
      expect(value()!.className).not.toContain('text-aurora');
    });
  });

  it('renders an optional hint', () => {
    set({ hint: 'On track for the month' });
    expect(fixture.nativeElement.textContent).toContain('On track for the month');
  });
});
