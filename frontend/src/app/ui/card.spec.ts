import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Card } from './card';

describe('Card', () => {
  let fixture: ComponentFixture<Card>;
  const host = () => fixture.nativeElement as HTMLElement;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Card] }).compileComponents();
    fixture = TestBed.createComponent(Card);
    fixture.detectChanges();
  });

  it('uses only semantic surface tokens, so light mode needs no per-card work', () => {
    expect(host().className).toContain('bg-card');
    expect(host().className).toContain('border-line');
  });

  it('applies medium padding by default', () => {
    expect(host().className).toContain('p-4');
  });

  it.each([
    ['sm', 'p-3'],
    ['lg', 'p-6'],
  ])('applies %s padding', (padding, expected) => {
    set({ padding });
    expect(host().className).toContain(expected);
  });

  it('can drop padding entirely for flush content like tables', () => {
    set({ padding: 'none' });
    expect(host().className).not.toMatch(/\bp-\d/);
  });

  it('adds a hover affordance only when interactive', () => {
    expect(host().className).not.toContain('cursor-pointer');
    set({ interactive: true });
    expect(host().className).toContain('cursor-pointer');
    expect(host().className).toContain('focus-within:border-brand-teal/60');
  });

  it('drops its border when nested inside another bordered surface', () => {
    set({ flush: true });
    expect(host().className).not.toContain('border-line');
    expect(host().className).toContain('bg-card');
  });
});

@Component({
  imports: [Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-card>
      <h3 uiCardHeader>Budget</h3>
      <p class="body">Travel is at 78%.</p>
      <div uiCardFooter>Updated just now</div>
    </ui-card>
  `,
})
class ProjectionHost {}

describe('Card content projection', () => {
  it('projects header, body and footer in document order', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectionHost] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectionHost);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('ui-card') as HTMLElement;
    const order = Array.from(card.children).map((child) => child.tagName);

    expect(order).toEqual(['H3', 'P', 'DIV']);
    expect(card.textContent).toContain('Budget');
    expect(card.textContent).toContain('Travel is at 78%.');
    expect(card.textContent).toContain('Updated just now');
  });
});
