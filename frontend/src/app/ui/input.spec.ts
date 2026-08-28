import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { Input } from './input';

describe('Input', () => {
  let fixture: ComponentFixture<Input>;

  const field = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
  const label = () => fixture.nativeElement.querySelector('label') as HTMLLabelElement;
  const toggle = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Input] }).compileComponents();
    fixture = TestBed.createComponent(Input);
    fixture.componentRef.setInput('label', 'Merchant');
    fixture.detectChanges();
  });

  describe('labelling', () => {
    it('associates the label with the field', () => {
      expect(label().textContent?.trim()).toContain('Merchant');
      expect(label().getAttribute('for')).toBe(field().id);
      expect(field().id).toBeTruthy();
    });

    it('gives each instance a unique id', async () => {
      const second = TestBed.createComponent(Input);
      second.componentRef.setInput('label', 'Category');
      second.detectChanges();

      const otherId = (second.nativeElement.querySelector('input') as HTMLInputElement).id;
      expect(otherId).not.toBe(field().id);
    });

    it('accepts an explicit id', () => {
      set({ id: 'gemini-key' });
      expect(field().id).toBe('gemini-key');
      expect(label().getAttribute('for')).toBe('gemini-key');
    });

    it('marks required fields for both sighted and assistive users', () => {
      set({ required: true });
      expect(field().getAttribute('aria-required')).toBe('true');
      expect(label().textContent).toContain('*');
    });
  });

  describe('hint and error', () => {
    it('points aria-describedby at the hint', () => {
      set({ hint: 'Stored only in this browser.' });
      const hintId = field().getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${hintId}`).textContent).toContain(
        'Stored only in this browser.',
      );
    });

    it('is not marked invalid without an error', () => {
      set({ hint: 'Optional.' });
      expect(field().getAttribute('aria-invalid')).toBeNull();
    });

    it('replaces the hint with the error and flips aria-invalid', () => {
      set({ hint: 'Optional.', error: 'Pick a category before submitting.' });

      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.textContent).toContain('Pick a category before submitting.');
      expect(fixture.nativeElement.textContent).not.toContain('Optional.');

      const describedBy = field().getAttribute('aria-describedby');
      expect(fixture.nativeElement.querySelector(`#${describedBy}`).getAttribute('role')).toBe(
        'alert',
      );
    });

    it('paints the danger border only while errored', () => {
      expect(field().className).toContain('border-line');
      set({ error: 'Required.' });
      expect(field().className).toContain('border-status-danger');
    });
  });

  describe('masked variant', () => {
    it('has no reveal toggle for ordinary types', () => {
      expect(toggle()).toBeNull();
    });

    it('renders a reveal toggle for password fields', () => {
      set({ type: 'password' });
      expect(toggle()).not.toBeNull();
      expect(field().getAttribute('type')).toBe('password');
    });

    it('reveals and re-masks the value', () => {
      set({ type: 'password' });

      toggle()!.click();
      fixture.detectChanges();
      expect(field().getAttribute('type')).toBe('text');

      toggle()!.click();
      fixture.detectChanges();
      expect(field().getAttribute('type')).toBe('password');
    });

    it('names the toggle for screen readers and tracks its pressed state', () => {
      set({ type: 'password', label: 'Gemini API key' });

      expect(toggle()!.getAttribute('aria-label')).toBe('Show Gemini API key');
      expect(toggle()!.getAttribute('aria-pressed')).toBe('false');

      toggle()!.click();
      fixture.detectChanges();

      expect(toggle()!.getAttribute('aria-label')).toBe('Hide Gemini API key');
      expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    });

    it('is type="button" so it never submits the surrounding form', () => {
      set({ type: 'password' });
      expect(toggle()!.getAttribute('type')).toBe('button');
    });

    it('leaves room for the toggle so long keys are not hidden under it', () => {
      set({ type: 'password' });
      expect(field().className).toContain('pr-11');
    });
  });

  describe('value', () => {
    it('reflects the bound value', () => {
      set({ value: 'Blue Tokai' });
      expect(field().value).toBe('Blue Tokai');
    });

    it('writes user input back to the model', () => {
      field().value = 'Chai Point';
      field().dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.componentInstance.value()).toBe('Chai Point');
    });
  });

  describe('disabled and read-only', () => {
    it('disables the field and its toggle together', () => {
      set({ type: 'password', disabled: true });
      expect(field().disabled).toBe(true);
      expect(toggle()!.disabled).toBe(true);
    });

    it('supports read-only without disabling', () => {
      set({ readonly: true });
      expect(field().readOnly).toBe(true);
      expect(field().disabled).toBe(false);
    });
  });

  it('clears the 44px touch target (§3.7)', () => {
    expect(field().className).toContain('min-h-11');
  });
});

@Component({
  imports: [ReactiveFormsModule, Input],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form">
      <ui-input label="Gemini API key" type="password" formControlName="geminiKey" />
    </form>
  `,
})
class FormHost {
  readonly form = new FormGroup({ geminiKey: new FormControl('') });
  readonly touched = signal(false);
}

describe('Input as a ControlValueAccessor', () => {
  let fixture: ComponentFixture<FormHost>;
  let host: FormHost;

  const field = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    fixture = TestBed.createComponent(FormHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the control value', () => {
    host.form.controls.geminiKey.setValue('AIza-not-a-real-key');
    fixture.detectChanges();
    expect(field().value).toBe('AIza-not-a-real-key');
  });

  it('pushes typed input into the control', () => {
    field().value = 'typed-key';
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.form.controls.geminiKey.value).toBe('typed-key');
  });

  it('marks the control touched on blur', () => {
    expect(host.form.controls.geminiKey.touched).toBe(false);
    field().dispatchEvent(new Event('blur'));
    expect(host.form.controls.geminiKey.touched).toBe(true);
  });

  it('honours a control disabled by the form', () => {
    host.form.controls.geminiKey.disable();
    fixture.detectChanges();
    expect(field().disabled).toBe(true);
  });
});
