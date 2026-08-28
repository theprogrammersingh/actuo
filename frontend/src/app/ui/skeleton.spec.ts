import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Skeleton, type SkeletonShape } from './skeleton';

describe('Skeleton', () => {
  let fixture: ComponentFixture<Skeleton>;
  const host = () => fixture.nativeElement as HTMLElement;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Skeleton] }).compileComponents();
    fixture = TestBed.createComponent(Skeleton);
    fixture.detectChanges();
  });

  describe('accessibility', () => {
    it('announces itself as a busy live region', () => {
      expect(host().getAttribute('role')).toBe('status');
      expect(host().getAttribute('aria-busy')).toBe('true');
      expect(host().getAttribute('aria-live')).toBe('polite');
    });

    it('carries one screen-reader message instead of a burst of empty boxes', () => {
      set({ label: 'Loading expenses' });
      expect(host().querySelector('.sr-only')?.textContent?.trim()).toBe('Loading expenses');
    });

    it('hides the placeholder boxes from assistive tech', () => {
      const boxes = host().querySelector('div');
      expect(boxes?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('shapes', () => {
    it.each<SkeletonShape>(['text', 'list', 'table', 'card', 'circle', 'block'])(
      'renders the %s shape',
      (shape) => {
        set({ shape });
        expect(host().querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
      },
    );

    it('renders one bar per text line, with a short last line', () => {
      set({ shape: 'text', lines: 4 });
      const bars = Array.from(host().querySelectorAll('.animate-pulse')) as HTMLElement[];

      expect(bars).toHaveLength(4);
      expect(bars[0].style.width).toBe('100%');
      expect(bars[3].style.width).toBe('65%');
    });

    it('renders one row per list item', () => {
      set({ shape: 'list', lines: 5 });
      expect(host().querySelectorAll('li')).toHaveLength(5);
    });

    it('renders a header row plus body rows at the requested width', () => {
      set({ shape: 'table', rows: 4, columns: 5 });
      // 5 header cells + 4 rows x 5 cells.
      expect(host().querySelectorAll('.animate-pulse')).toHaveLength(5 + 4 * 5);
    });

    it('sizes block placeholders from width and height', () => {
      set({ shape: 'block', width: '12rem', height: '3rem' });
      const box = host().querySelector('.animate-pulse') as HTMLElement;
      expect(box.style.width).toBe('12rem');
      expect(box.style.height).toBe('3rem');
    });

    it('makes circles square from width alone', () => {
      set({ shape: 'circle', width: '2.5rem' });
      const box = host().querySelector('.animate-pulse') as HTMLElement;
      expect(box.style.width).toBe('2.5rem');
      expect(box.style.height).toBe('2.5rem');
    });
  });

  describe('degenerate counts', () => {
    it('never renders zero or negative rows', () => {
      set({ shape: 'text', lines: 0 });
      expect(host().querySelectorAll('.animate-pulse')).toHaveLength(1);

      set({ lines: -3 });
      expect(host().querySelectorAll('.animate-pulse')).toHaveLength(1);
    });
  });

  it('shimmers rather than spins — skeletons, not spinners (§3.6)', () => {
    expect(host().querySelector('.animate-spin')).toBeNull();
    expect(host().querySelector('.animate-pulse')).not.toBeNull();
  });
});
