import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { Button, Card, Input } from '../../ui';
import { Session, SessionError } from '../../core/session/session.js';

/**
 * Mirrors `SignupDto`'s `@MinLength(12)` in `backend/`. Duplicated on purpose:
 * the server is the enforcer, but finding out about it after a round-trip is a
 * worse experience than being told while typing.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Sign-up (PRD §6.1).
 *
 * Signing up creates a person *and* the organization they will own — Actuo has
 * no join-an-existing-org path in v1, so the org name is a required field
 * rather than an optional flourish. The copy says so, because "Organization
 * name" with no explanation reads like a field you could skip.
 *
 * Like {@link Login}, this never navigates; it emits {@link authenticated} and
 * the shell's guards decide where a signed-in visitor belongs.
 */
@Component({
  selector: 'app-signup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Card, Input],
  host: { class: 'block' },
  template: `
    <section class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:py-16">
      <header>
        <h1 class="font-display text-2xl font-semibold text-body">Create your organization</h1>
        <p class="mt-1.5 text-sm text-muted">
          You will be its owner. Colleagues can be invited afterwards.
        </p>
      </header>

      <ui-card padding="lg">
        <form class="flex flex-col gap-4" novalidate (submit)="onSubmit($event)">
          <ui-input
            label="Your name"
            name="name"
            autocomplete="name"
            placeholder="Priya Sharma"
            [(value)]="name"
            [error]="nameError()"
            required
          />

          <ui-input
            label="Organization name"
            name="orgName"
            autocomplete="organization"
            placeholder="Northwind Design"
            hint="Shown on reports and shared with everyone you invite."
            [(value)]="orgName"
            [error]="orgNameError()"
            required
          />

          <ui-input
            label="Work email"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@company.com"
            [(value)]="email"
            [error]="emailError()"
            required
          />

          <ui-input
            label="Password"
            type="password"
            name="password"
            autocomplete="new-password"
            [hint]="'At least ' + minPasswordLength + ' characters. Length beats punctuation.'"
            [(value)]="password"
            [error]="passwordError()"
            required
          />

          @if (formError(); as message) {
            <p
              class="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2
                     text-sm text-status-danger"
              role="alert"
            >
              {{ message }}
            </p>
          }

          <button
            uiButton
            type="submit"
            size="lg"
            block
            [loading]="busy()"
            loadingLabel="Creating your organization"
          >
            Create organization
          </button>
        </form>
      </ui-card>

      <p class="text-center text-sm text-muted">
        Already have an account?
        <button
          type="button"
          class="rounded font-medium text-brand-teal underline underline-offset-4
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
          (click)="wantsLogin.emit()"
        >
          Sign in
        </button>
      </p>
    </section>
  `,
})
export class Signup {
  private readonly session = inject(Session);

  readonly authenticated = output<void>();
  readonly wantsLogin = output<void>();

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  protected readonly name = signal('');
  protected readonly orgName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly busy = this.session.busy;

  protected readonly nameError = computed(() =>
    this.submitted() && !this.name().trim() ? 'Tell us what to call you.' : null,
  );

  protected readonly orgNameError = computed(() =>
    this.submitted() && !this.orgName().trim()
      ? 'Give the organization a name — your company or team will do.'
      : null,
  );

  protected readonly emailError = computed(() => {
    if (!this.submitted()) return null;
    const value = this.email().trim();
    if (!value) return 'An email address is needed to sign in later.';
    if (!value.includes('@')) return 'That does not look like an email address.';
    return null;
  });

  protected readonly passwordError = computed(() => {
    if (!this.submitted()) return null;
    const value = this.password();
    if (!value) return 'Choose a password.';
    if (value.length < MIN_PASSWORD_LENGTH) {
      const short = MIN_PASSWORD_LENGTH - value.length;
      return `${short} more character${short === 1 ? '' : 's'} needed — the minimum is ${MIN_PASSWORD_LENGTH}.`;
    }
    return null;
  });

  protected readonly hasFieldErrors = computed(
    () =>
      this.nameError() !== null ||
      this.orgNameError() !== null ||
      this.emailError() !== null ||
      this.passwordError() !== null,
  );

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.createAccount();
  }

  private async createAccount(): Promise<void> {
    this.submitted.set(true);
    this.formError.set(null);
    if (this.hasFieldErrors()) return;

    try {
      await this.session.signup({
        name: this.name().trim(),
        orgName: this.orgName().trim(),
        email: this.email().trim(),
        password: this.password(),
      });
      this.password.set('');
      this.authenticated.emit();
    } catch (error) {
      this.formError.set(
        error instanceof SessionError
          ? error.message
          : 'The account was not created. Try again in a moment.',
      );
    }
  }
}
