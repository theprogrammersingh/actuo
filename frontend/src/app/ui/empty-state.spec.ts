import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Button } from './button';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  let fixture: ComponentFixture<EmptyState>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmptyState] }).compileComponents();
    fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('heading', 'No expenses yet');
    fixture.componentRef.setInput(
      'message',
      'Add one, or ask the Copilot to log something for you.',
    );
    fixture.detectChanges();
  });

  it('renders specific copy, not a bare "No data" (§3.6)', () => {
    expect(host().textContent).toContain('No expenses yet');
    expect(host().textContent).toContain('Add one, or ask the Copilot to log something for you.');
  });

  it('renders the heading as a real heading, defaulting to h3', () => {
    expect(host().querySelector('h3')?.textContent?.trim()).toBe('No expenses yet');
  });

  it.each([2, 4] as const)('can render at heading level %d to match the outline', (level) => {
    fixture.componentRef.setInput('headingLevel', level);
    fixture.detectChanges();
    expect(host().querySelector(`h${level}`)?.textContent?.trim()).toBe('No expenses yet');
  });

  it('hides its decorative accent from assistive tech', () => {
    const icon = host().querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does not use the scarce aurora gradient — empty states are common (§2.2)', () => {
    expect(host().innerHTML).not.toContain('bg-aurora');
    expect(host().innerHTML).not.toContain('text-aurora');
  });
});

@Component({
  imports: [EmptyState, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-empty-state heading="No expenses yet" message="Add one to get started.">
      <svg uiEmptyIcon data-custom-icon></svg>
      <button uiButton uiEmptyAction (click)="added.set(true)">Add expense</button>
    </ui-empty-state>
  `,
})
class ProjectionHost {
  readonly added = signal(false);
}

describe('EmptyState slots', () => {
  let fixture: ComponentFixture<ProjectionHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProjectionHost] }).compileComponents();
    fixture = TestBed.createComponent(ProjectionHost);
    fixture.detectChanges();
  });

  it('replaces the default icon with a projected one', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-custom-icon]')).not.toBeNull();
    // The fallback should be gone, not stacked underneath.
    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });

  it('projects and wires up an action', () => {
    const action = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(action.textContent?.trim()).toBe('Add expense');

    action.click();
    expect(fixture.componentInstance.added()).toBe(true);
  });
});
