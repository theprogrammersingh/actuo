import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  Badge,
  EXPENSE_STATUS_LABEL,
  EXPENSE_STATUS_TONE,
  type BadgeTone,
  type ExpenseStatus,
} from './badge';

describe('Badge', () => {
  let fixture: ComponentFixture<Badge>;

  const pill = () => fixture.nativeElement.querySelector('.pill') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Badge] }).compileComponents();
    fixture = TestBed.createComponent(Badge);
    fixture.detectChanges();
  });

  describe('expense status → status.* tone', () => {
    /**
     * The mapping is the contract other views depend on. `approved` is info and
     * `reimbursed` is success on purpose — see the rationale in badge.ts.
     */
    const cases: ReadonlyArray<[ExpenseStatus, BadgeTone]> = [
      ['draft', 'neutral'],
      ['submitted', 'warning'],
      ['approved', 'info'],
      ['rejected', 'danger'],
      ['reimbursed', 'success'],
    ];

    it.each(cases)('maps %s to the %s tone', (status, tone) => {
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();

      expect(fixture.componentInstance.tone()).toBe(tone);
      expect(pill().className).toContain(`tone-${tone}`);
    });

    it.each(cases)('renders a human label for %s', (status) => {
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();
      expect(pill().textContent?.trim()).toBe(EXPENSE_STATUS_LABEL[status]);
    });

    it('covers all five statuses with no gaps', () => {
      expect(Object.keys(EXPENSE_STATUS_TONE).sort()).toEqual([
        'approved',
        'draft',
        'reimbursed',
        'rejected',
        'submitted',
      ]);
      expect(Object.keys(EXPENSE_STATUS_LABEL).sort()).toEqual(
        Object.keys(EXPENSE_STATUS_TONE).sort(),
      );
    });

    it('keeps approved and reimbursed visually distinct', () => {
      expect(EXPENSE_STATUS_TONE.approved).not.toBe(EXPENSE_STATUS_TONE.reimbursed);
    });
  });

  it('falls back to the explicit tone when no status is given', () => {
    fixture.componentRef.setInput('tone', 'info');
    fixture.componentRef.setInput('label', 'via cambiaro.programmersingh.dev');
    fixture.detectChanges();

    expect(fixture.componentInstance.tone()).toBe('info');
    expect(pill().textContent?.trim()).toBe('via cambiaro.programmersingh.dev');
  });

  it('lets an explicit label override the status label', () => {
    fixture.componentRef.setInput('status', 'submitted');
    fixture.componentRef.setInput('label', 'Awaiting Priya');
    fixture.detectChanges();

    // Tone still comes from the status; only the words changed.
    expect(fixture.componentInstance.tone()).toBe('warning');
    expect(pill().textContent?.trim()).toBe('Awaiting Priya');
  });

  it('carries a decorative dot that is hidden from assistive tech', () => {
    fixture.componentRef.setInput('status', 'approved');
    fixture.detectChanges();

    const dot = pill().querySelector('.dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('can drop the dot', () => {
    fixture.componentRef.setInput('status', 'approved');
    fixture.componentRef.setInput('dot', false);
    fixture.detectChanges();
    expect(pill().querySelector('.dot')).toBeNull();
  });

  it('never relies on hue alone — the text label is always present', () => {
    fixture.componentRef.setInput('status', 'rejected');
    fixture.componentRef.setInput('dot', false);
    fixture.detectChanges();
    expect(pill().textContent?.trim().length).toBeGreaterThan(0);
  });
});
