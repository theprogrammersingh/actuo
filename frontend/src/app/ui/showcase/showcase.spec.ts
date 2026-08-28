import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ThemeService } from '../../core/theme/theme-service';
import { Showcase } from './showcase';

describe('Showcase', () => {
  let fixture: ComponentFixture<Showcase>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [Showcase] }).compileComponents();
    fixture = TestBed.createComponent(Showcase);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders every component in the library', () => {
    for (const selector of [
      'button[uiButton]',
      'ui-card',
      'ui-badge',
      'ui-input',
      'ui-stat-card',
      'ui-progress-bar',
      'ui-skeleton',
      'ui-empty-state',
      'ui-error-state',
    ]) {
      expect(host().querySelector(selector), `missing ${selector}`).not.toBeNull();
    }
  });

  it('shows all five expense statuses', () => {
    expect(host().querySelectorAll('ui-badge').length).toBeGreaterThanOrEqual(5);
    for (const label of ['Draft', 'Submitted', 'Approved', 'Rejected', 'Reimbursed']) {
      expect(host().textContent).toContain(label);
    }
  });

  /**
   * §2.2 — the aurora gradient is scarce: never more than one element per
   * viewport. The showcase is the one page most likely to violate that by
   * accident, so it is asserted here rather than left to review.
   */
  it('uses the aurora gradient exactly once', () => {
    const aurora = host().querySelectorAll('[class*="bg-aurora"], [class*="text-aurora"]');
    expect(aurora).toHaveLength(1);
  });

  it('drives the theme through ThemeService', () => {
    const theme = TestBed.inject(ThemeService);
    const toggleButton = host().querySelector('header button') as HTMLButtonElement;

    expect(theme.theme()).toBe('dark');

    toggleButton.click();
    TestBed.inject(ApplicationRef).tick();
    fixture.detectChanges();

    expect(theme.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(toggleButton.getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  it('demonstrates the ramp across every progress-bar tone', () => {
    const fills = Array.from(host().querySelectorAll('[role="progressbar"] > div'));
    const classes = fills.map((fill) => fill.className).join(' ');

    expect(classes).toContain('bg-status-success');
    expect(classes).toContain('bg-status-warning');
    expect(classes).toContain('bg-status-danger');
  });

  it('shows the masked BYOK key field', () => {
    const masked = Array.from(host().querySelectorAll('input')).find(
      (field) => field.getAttribute('type') === 'password',
    );
    expect(masked).toBeDefined();
  });
});
