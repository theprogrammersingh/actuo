import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToolCallCard } from './tool-call-card';

describe('ToolCallCard', () => {
  let fixture: ComponentFixture<ToolCallCard>;

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ToolCallCard);
    fixture.componentRef.setInput('name', 'search_expenses');
    fixture.componentRef.setInput('summary', 'Searched expenses: last 30 days');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const text = () => fixture.nativeElement.textContent as string;
  const html = () => fixture.nativeElement.innerHTML as string;

  beforeEach(() => TestBed.resetTestingModule());

  it('shows the tool name and summary', () => {
    create();
    expect(text()).toContain('search_expenses');
    expect(text()).toContain('Searched expenses: last 30 days');
  });

  // §3.2.3 — collapsed by default so the chat stays readable.
  it('collapses details by default', () => {
    create({ input: { query: 'coffee' } });
    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(text()).not.toContain('"query"');
  });

  it('reveals raw input and result when expanded', () => {
    create({ input: { query: 'coffee' }, result: { total: 3 }, state: 'done' });
    fixture.componentInstance.toggle();
    fixture.detectChanges();

    expect(text()).toContain('"query"');
    expect(text()).toContain('"total"');
  });

  // §3.5 — the summary is the accessible name of the expander, not an icon.
  it('uses the summary as the expander label and tracks aria-expanded', () => {
    create();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[aria-expanded]');

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('Searched expenses: last 30 days');

    fixture.componentInstance.toggle();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  // §3.2.3 — read-only vs mutating, and never by colour alone.
  it('marks a read-only call blue with a text equivalent', () => {
    create({ mutates: false });
    expect(html()).toContain('bg-status-info');
    expect(text()).toContain('Read-only.');
  });

  it('marks a mutating call amber with a text equivalent', () => {
    create({ mutates: true });
    expect(html()).toContain('bg-status-warning');
    expect(text()).toContain('Changes data.');
  });

  // §3.2.5 — makes the cross-origin capability visible rather than invisible.
  it('shows the origin badge only for cross-origin calls', () => {
    create();
    expect(text()).not.toContain('via ');

    create({ origin: 'partner-demo.app' });
    expect(text()).toContain('via partner-demo.app');
  });

  // §3.2.4 — a mutating call is never executed silently.
  it('offers Confirm/Cancel and auto-expands while awaiting confirmation', () => {
    create({ state: 'awaiting-confirmation', input: { amount: 1200 } });

    expect(fixture.componentInstance.expanded()).toBe(true);
    expect(text()).toContain('Confirm');
    expect(text()).toContain('Cancel');
    // The user must be able to see what they are approving.
    expect(text()).toContain('"amount"');
  });

  it('emits confirm and cancel', () => {
    create({ state: 'awaiting-confirmation' });
    let confirmed = 0;
    let cancelled = 0;
    fixture.componentInstance.confirm.subscribe(() => confirmed++);
    fixture.componentInstance.cancel.subscribe(() => cancelled++);

    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.trim() === 'Confirm')!.click();
    buttons.find((b) => b.textContent?.trim() === 'Cancel')!.click();

    expect(confirmed).toBe(1);
    expect(cancelled).toBe(1);
  });

  // §3.2.6 — a real Stop for cancellable work.
  it('shows Stop only while a cancellable call is running', () => {
    create({ state: 'running', cancellable: true });
    expect(text()).toContain('Stop');

    create({ state: 'running', cancellable: false });
    expect(text()).not.toContain('Stop');

    create({ state: 'done', cancellable: true });
    expect(text()).not.toContain('Stop');
  });

  it('renders the error instead of the result when the call failed', () => {
    create({ state: 'error', error: 'Category "Food" not found', result: { nope: 1 } });
    fixture.componentInstance.toggle();
    fixture.detectChanges();

    expect(text()).toContain('Failed');
    expect(text()).toContain('Category "Food" not found');
    expect(text()).not.toContain('"nope"');
  });

  it('reports a cancelled call distinctly from a failed one', () => {
    create({ state: 'cancelled' });
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Failed');
  });
});
